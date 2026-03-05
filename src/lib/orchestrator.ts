import type { CollabConfig, RepoConfig } from './config';
import type { Executor } from './executor';
import { CliError, CommandExecutionError } from './errors';
import type { Logger } from './logger';
import { loadState, saveState, type WorkflowFailureState, type WorkflowRunState } from './state';

export interface StageContext {
  config: CollabConfig;
  executor: Executor;
  logger: Logger;
  options?: Record<string, unknown>;
}

/**
 * Returns the effective base directory for stages that write per-repo files.
 * In workspace mode (repoConfig present) this is the individual repo dir;
 * in single-repo mode it falls back to workspaceDir.
 */
export function getRepoBaseDir(ctx: StageContext): string {
  const rc = ctx.options?._repoConfig as RepoConfig | undefined;
  return rc ? rc.repoDir : ctx.config.workspaceDir;
}

export interface OrchestrationStage {
  id: string;
  title: string;
  recovery: string[];
  run: (context: StageContext) => Promise<void> | void;
}

export interface OrchestratorOptions {
  workflowId: string;
  config: CollabConfig;
  executor: Executor;
  logger: Logger;
  resume?: boolean;
  mode?: string;
  stageOptions?: Record<string, unknown>;
}

/**
 * Inspects stderr for well-known platform-specific errors and returns
 * additional recovery hints that are appended to the stage's recovery list.
 */
function detectPlatformHints(stderr: string | undefined): string[] {
  if (!stderr) return [];

  const hints: string[] = [];

  // macOS: Docker credential helper cannot access the keychain
  if (
    process.platform === 'darwin' &&
    /keychain.*cannot be accessed|error getting credentials/i.test(stderr)
  ) {
    hints.push(
      'macOS keychain is locked. Run: security unlock-keychain ~/Library/Keychains/login.keychain-db',
    );
  }

  // Docker daemon not running
  if (/cannot connect to.*docker daemon|is the docker daemon running/i.test(stderr)) {
    hints.push(
      'Docker daemon is not running. Start Docker Desktop or run: sudo systemctl start docker',
    );
  }

  // Docker registry authentication failure
  if (/denied.*login|unauthorized|authentication required/i.test(stderr)) {
    hints.push('Docker registry auth failed. Run: docker login ghcr.io');
  }

  // ARM64 / multi-platform manifest mismatch
  if (/no matching manifest.*arm64|no matching manifest for.*platform/i.test(stderr)) {
    hints.push(
      'Image not available for this platform. Verify the image supports linux/arm64 or rebuild with --platform.',
    );
  }

  // Network errors during image pull
  if (/network.*unreachable|timeout.*pull|dial tcp.*connection refused/i.test(stderr)) {
    hints.push('Network error pulling images. Check internet connection and DNS settings.');
  }

  return hints;
}

function formatFailure(failure: WorkflowFailureState): string {
  const lines: string[] = [];
  lines.push(`Stage '${failure.stage}' failed.`);
  lines.push(failure.message);

  if (failure.command) {
    lines.push('');
    lines.push(`Command: ${failure.command}`);
  }

  if (failure.stderr && failure.stderr.trim().length > 0) {
    lines.push('');
    lines.push('stderr:');
    lines.push(failure.stderr.trim());
  }

  const platformHints = detectPlatformHints(failure.stderr);
  const allRecovery = [...failure.recovery, ...platformHints];

  if (allRecovery.length > 0) {
    lines.push('');
    lines.push('Recovery actions:');
    for (const step of allRecovery) {
      lines.push(`- ${step}`);
    }
  }

  return lines.join('\n');
}

function currentWorkflowState(workflow?: WorkflowRunState): WorkflowRunState {
  return {
    completedStages: workflow?.completedStages ?? [],
    updatedAt: workflow?.updatedAt ?? new Date().toISOString(),
    failure: workflow?.failure,
  };
}

export async function runOrchestration(
  options: OrchestratorOptions,
  stages: readonly OrchestrationStage[],
): Promise<void> {
  const state = loadState(options.config);
  const previous = currentWorkflowState(state.workflows[options.workflowId]);
  const completed = new Set(options.resume ? previous.completedStages : []);

  if (options.mode) {
    options.logger.workflowHeader(options.workflowId, options.mode);
  }

  if (options.resume && completed.size > 0) {
    options.logger.info(
      `Resuming '${options.workflowId}': ${completed.size}/${stages.length} stages complete.`,
    );
    for (const stage of stages) {
      const status = completed.has(stage.id) ? '[done]' : '[pending]';
      options.logger.info(`  ${status} ${stage.title}`);
    }
  }

  const total = stages.length;
  let stageIndex = 0;

  for (const stage of stages) {
    stageIndex++;

    if (options.resume && completed.has(stage.id)) {
      options.logger.info(`Skipping completed stage '${stage.title}'`);
      continue;
    }

    options.logger.stageHeader(stageIndex, total, stage.title);

    try {
      await stage.run({
        config: options.config,
        executor: options.executor,
        logger: options.logger,
        options: options.stageOptions,
      });

      completed.add(stage.id);
      state.workflows[options.workflowId] = {
        completedStages: [...completed],
        updatedAt: new Date().toISOString(),
      };
      saveState(options.config, state, options.executor);
      options.logger.step(true, stage.title);
    } catch (error: unknown) {
      const failure: WorkflowFailureState = {
        stage: stage.id,
        message: error instanceof Error ? error.message : String(error),
        recovery: stage.recovery.length > 0 ? stage.recovery : ['Run the workflow again with --resume.'],
        failedAt: new Date().toISOString(),
      };

      if (error instanceof CommandExecutionError) {
        failure.command = error.details.command;
        failure.stderr = error.details.stderr || error.details.stdout;
      }

      state.workflows[options.workflowId] = {
        completedStages: [...completed],
        updatedAt: new Date().toISOString(),
        failure,
      };
      saveState(options.config, state, options.executor);

      throw new CliError(formatFailure(failure));
    }
  }

  state.workflows[options.workflowId] = {
    completedStages: [...completed],
    updatedAt: new Date().toISOString(),
  };
  saveState(options.config, state, options.executor);
}

/**
 * Runs a set of stages scoped to a single repo inside a workspace.
 *
 * - Uses a namespaced workflow ID (`{baseId}:{repoName}`) for resume support.
 * - Overrides `config.repoDir` and `config.aiDir` so existing stages write
 *   into the repo instead of the workspace root.
 * - Passes the `RepoConfig` via `stageOptions._repoConfig`.
 */
export async function runPerRepoOrchestration(
  baseOptions: OrchestratorOptions,
  repoConfig: RepoConfig,
  stages: readonly OrchestrationStage[],
): Promise<void> {
  const repoWorkflowId = `${baseOptions.workflowId}:${repoConfig.name}`;

  const repoAwareConfig: CollabConfig = {
    ...baseOptions.config,
    repoDir: repoConfig.architectureRepoDir,
    aiDir: repoConfig.aiDir,
  };

  const stageOptions = {
    ...baseOptions.stageOptions,
    _repoConfig: repoConfig,
  };

  await runOrchestration(
    {
      ...baseOptions,
      workflowId: repoWorkflowId,
      config: repoAwareConfig,
      stageOptions,
    },
    stages,
  );
}
