import fs from 'node:fs';
import path from 'node:path';

import {
  defaultCollabConfig,
  type CollabConfig,
} from '../../lib/config';
import { isBusinessCanonConfigured } from '../../lib/canon-resolver';
import { CliError } from '../../lib/errors';
import type { Executor } from '../../lib/executor';
import { storeGitHubToken } from '../../lib/github-auth';
import type { Logger } from '../../lib/logger';
import { parseMode } from '../../lib/mode';
import type { OrchestrationStage } from '../../lib/orchestrator';
import { runOrchestration } from '../../lib/orchestrator';
import { promptChoice } from '../../lib/prompt';
import { buildFileOnlyDomainPipeline, buildIndexedDomainPipeline } from '../../stages/domain-gen';
import { buildRepoIngestStage } from '../../stages/repo-ingest';

import type { InitOptions } from './types';
import { parseBusinessCanonOption } from './business-canon';

/**
 * Resolves and validates the path to a repository package.
 *
 * Resolution order:
 *   1. Absolute path → use directly
 *   2. Relative path from workspace dir → resolve
 *   3. Name within workspace → join with workspaceDir
 *
 * @throws {CliError} When the path is not found or is not a directory.
 */
function resolveRepoPath(repoValue: string, config: CollabConfig): string {
  const isDirectory = (p: string): boolean => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  };

  // 1. Absolute path
  if (path.isAbsolute(repoValue)) {
    if (!fs.existsSync(repoValue)) {
      throw new CliError(`Repository path not found: ${repoValue}`);
    }
    if (!isDirectory(repoValue)) {
      throw new CliError(`Repository path is not a directory: ${repoValue}`);
    }
    return repoValue;
  }

  // 2. Relative path from workspace dir (respects --cwd)
  const fromCwd = path.resolve(config.workspaceDir, repoValue);
  if (isDirectory(fromCwd)) {
    return fromCwd;
  }

  // 3. Name within workspace
  const fromWorkspace = path.join(config.workspaceDir, repoValue);
  if (isDirectory(fromWorkspace)) {
    return fromWorkspace;
  }

  throw new CliError(
    `Repository "${repoValue}" not found.\n` +
      `Searched:\n` +
      `  - ${fromCwd}\n` +
      `  - ${fromWorkspace}\n` +
      `Provide an absolute path, a relative path from cwd, or a repo name within your workspace.`,
  );
}

export async function runRepoDomainGeneration(
  context: { config: CollabConfig; executor: Executor; logger: Logger },
  options: InitOptions,
): Promise<void> {
  const repoValue = options.repo!;

  // Build a minimal config — reuse existing if available
  const effectiveConfig: CollabConfig = {
    ...defaultCollabConfig(context.config.workspaceDir),
    ...context.config,
  };

  // Resolve mode early so parseBusinessCanonOption gets the correct mode context
  let mode = parseMode(options.mode, 'file-only');
  if (options.mode) {
    mode = parseMode(options.mode);
  } else if (options.yes) {
    mode = 'file-only';
  } else {
    mode = await promptChoice(
      'Select domain generation mode:',
      [
        { value: 'file-only', label: 'file-only (write domain files to local repo only)' },
        { value: 'indexed', label: 'indexed (write to business canon + ingest into MCP)' },
      ],
      'file-only',
    );
  }

  // Resolve business canon if passed via flag (but don't require it for file-only)
  const canons = options.businessCanon ? parseBusinessCanonOption(options.businessCanon, mode) : undefined;
  if (canons) {
    effectiveConfig.canons = canons;
  }

  // Store GitHub token if provided (required for indexed push/sync)
  if (options.githubToken) {
    if (context.executor.dryRun) {
      context.logger.info('[dry-run] Would store GitHub token from --github-token flag.');
    } else {
      storeGitHubToken(effectiveConfig.collabDir, options.githubToken);
      context.logger.info('GitHub token stored from --github-token flag.');
    }
  }

  // Validate prerequisites
  if (mode === 'indexed' && !isBusinessCanonConfigured(effectiveConfig)) {
    throw new CliError(
      'Business canon is required for indexed mode. ' +
        'Use --business-canon owner/repo to configure it, or use --mode file-only.',
    );
  }

  // Resolve repo path
  const repoPath = resolveRepoPath(repoValue, effectiveConfig);
  const repoName = path.basename(repoPath);

  context.logger.phaseHeader('Domain Generation', `${repoName} (${mode})`);

  // Build pipeline
  const basePipeline = mode === 'file-only'
    ? buildFileOnlyDomainPipeline()
    : buildIndexedDomainPipeline();

  const stages: OrchestrationStage[] = [...basePipeline];
  if (!options.skipIngest) {
    stages.push(buildRepoIngestStage());
  }
  // Execute
  await runOrchestration(
    {
      workflowId: 'init:repo-domain',
      config: effectiveConfig,
      executor: context.executor,
      logger: context.logger,
      resume: options.resume,
      mode: `${mode} (repo domain)`,
      stageOptions: {
        _repoPath: repoPath,
        yes: options.yes,
        providers: options.providers,
      },
    },
    stages,
  );

  // Summary
  context.logger.phaseHeader('Domain Generation Complete');
  context.logger.summaryFooter([
    { label: 'Mode', value: mode },
    { label: 'Repository', value: repoName },
    { label: 'Dry-run', value: context.executor.dryRun ? 'yes' : 'no' },
  ]);
}
