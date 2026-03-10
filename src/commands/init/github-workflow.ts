import fs from 'node:fs';

import {
  defaultCollabConfig,
  type CollabConfig,
} from '../../lib/config';
import { CliError } from '../../lib/errors';
import type { Executor } from '../../lib/executor';
import type { Logger } from '../../lib/logger';
import { parseMode } from '../../lib/mode';
import { runOrchestration } from '../../lib/orchestrator';

import type { InitOptions } from './types';
import { buildGitHubWorkflowStages } from './pipelines';

/**
 * Runs the GitHub workflow setup as a standalone pipeline.
 *
 * Requires an existing `.collab/config.json`. Orchestrates three stages:
 *   1. github-auth — resolve/validate GitHub token
 *   2. github-setup — branch model, protection, workflows, secrets (indexed only)
 *   3. ci-setup — architecture PR/merge workflows (both modes)
 */
export async function runGitHubWorkflow(
  context: { config: CollabConfig; executor: Executor; logger: Logger },
  options: InitOptions,
): Promise<void> {
  // Require existing config — unlike `init infra` which can bootstrap
  if (!fs.existsSync(context.config.configFile)) {
    throw new CliError(
      'No .collab/config.json found. Run "collab init" first to set up the workspace,\n' +
        'then use "collab init github-workflow" to configure GitHub workflows.',
    );
  }

  // Build effective config from persisted + defaults
  const effectiveConfig: CollabConfig = {
    ...defaultCollabConfig(context.config.workspaceDir),
    ...context.config,
  };

  // Allow --mode override, but guard against indexed without workspace
  const requestedMode = options.mode ? parseMode(options.mode) : effectiveConfig.mode;
  if (requestedMode === 'indexed' && !effectiveConfig.workspace) {
    throw new CliError(
      'Indexed mode requires a workspace configuration.\n' +
        'Run "collab init" first to set up the workspace, then retry.',
    );
  }
  effectiveConfig.mode = requestedMode;

  // Summary header
  const modeLabel = effectiveConfig.mode;
  context.logger.phaseHeader('GitHub Workflow Setup', modeLabel);

  // Pipeline: github-auth → github-setup → ci-setup
  const stages = buildGitHubWorkflowStages(
    effectiveConfig,
    context.logger,
    options,
  );

  await runOrchestration(
    {
      workflowId: 'init:github-workflow',
      config: effectiveConfig,
      executor: context.executor,
      logger: context.logger,
      resume: options.resume,
      mode: `${modeLabel} (github-workflow)`,
      stageOptions: {
        skipGithubSetup: options.skipGithubSetup,
        skipCi: options.skipCi,
      },
    },
    stages,
  );

  // Summary footer
  context.logger.phaseHeader('GitHub Workflow Setup Complete');
  context.logger.summaryFooter([
    { label: 'Phase', value: 'github-workflow' },
    { label: 'Mode', value: effectiveConfig.mode },
    { label: 'Dry-run', value: context.executor.dryRun ? 'yes' : 'no' },
  ]);
}
