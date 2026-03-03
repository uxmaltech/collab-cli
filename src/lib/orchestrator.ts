import type { CollabConfig } from './config';
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

  if (failure.recovery.length > 0) {
    lines.push('');
    lines.push('Recovery actions:');
    for (const step of failure.recovery) {
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
      `Resuming workflow '${options.workflowId}' with ${completed.size} completed stage(s).`,
    );
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
