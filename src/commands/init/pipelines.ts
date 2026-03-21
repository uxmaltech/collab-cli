import type { CollabConfig } from '../../lib/config';
import { serializeUserConfig } from '../../lib/config';
import type { Executor } from '../../lib/executor';
import type { Logger } from '../../lib/logger';
import type { CollabMode } from '../../lib/mode';
import type { OrchestrationStage } from '../../lib/orchestrator';
import { assertPreflightChecks, runPreflightChecks } from '../../lib/preflight';

import { assistantSetupStage } from '../../stages/assistant-setup';
import { canonSyncStage } from '../../stages/canon-sync';
import { repoScaffoldStage } from '../../stages/repo-scaffold';
import { repoAnalysisStage } from '../../stages/repo-analysis';
import { repoAnalysisFileOnlyStage } from '../../stages/repo-analysis-fileonly';
import { agentSkillsSetupStage } from '../../stages/agent-skills-setup';
import { ciSetupStage } from '../../stages/ci-setup';
import { githubSetupStage } from '../../stages/github-setup';

import type { InitOptions } from './types';
import { buildGitHubAuthStage } from './mcp-helpers';

// Re-export infra stage builders so callers can import from './pipelines'
export { buildInfraStages, buildRemoteInfraStages } from './infra-stages';

export function buildPreflightStage(executor: Executor, logger: Logger, mode?: string): OrchestrationStage {
  return {
    id: 'preflight',
    title: 'Run preflight checks',
    recovery: [
      'Install missing dependencies reported by preflight.',
      'Run collab init --resume after fixing prerequisites.',
    ],
    run: () => {
      const checks = runPreflightChecks(executor, { mode });
      assertPreflightChecks(checks, logger);
    },
  };
}

export function buildConfigStage(
  effectiveConfig: CollabConfig,
  executor: Executor,
  logger: Logger,
  configExistedBefore: boolean,
  force?: boolean,
): OrchestrationStage {
  return {
    id: 'environment-setup',
    title: 'Write local collab configuration',
    recovery: [
      'Verify write permissions for .collab and workspace directory.',
      'Run collab init --resume once permissions are fixed.',
    ],
    run: () => {
      if (configExistedBefore && !force) {
        logger.info('Existing configuration detected; preserving it. Use --force to overwrite.');
        return;
      }

      executor.ensureDirectory(effectiveConfig.collabDir);
      executor.writeFile(
        effectiveConfig.configFile,
        `${serializeUserConfig(effectiveConfig)}\n`,
        { description: 'write collab config' },
      );
    },
  };
}

export function buildWorkspaceStages(
  effectiveConfig: CollabConfig,
  executor: Executor,
  logger: Logger,
  configExistedBefore: boolean,
  options: InitOptions,
): OrchestrationStage[] {
  return [
    buildPreflightStage(executor, logger),
    buildConfigStage(effectiveConfig, executor, logger, configExistedBefore, options.force),
    buildGitHubAuthStage(effectiveConfig, logger, options),
    assistantSetupStage,
    canonSyncStage,
  ];
}

export function buildPerRepoStages(mode: CollabMode): OrchestrationStage[] {
  const analysisStage = mode === 'indexed' ? repoAnalysisStage : repoAnalysisFileOnlyStage;
  return [
    repoScaffoldStage,
    analysisStage,
    ciSetupStage,
    agentSkillsSetupStage,
  ];
}

export function buildFileOnlyPipeline(
  effectiveConfig: CollabConfig,
  executor: Executor,
  logger: Logger,
  configExistedBefore: boolean,
  options: InitOptions,
): OrchestrationStage[] {
  return [
    buildPreflightStage(executor, logger),                     // 1
    buildConfigStage(effectiveConfig, executor, logger,
      configExistedBefore, options.force),                     // 2
    buildGitHubAuthStage(effectiveConfig, logger, options),    // 3
    assistantSetupStage,                                       // 4
    canonSyncStage,                                            // 5
    repoScaffoldStage,                                         // 6
    repoAnalysisFileOnlyStage,                                 // 7
    ciSetupStage,                                              // 8
    agentSkillsSetupStage,                                     // 9
  ];
}

export function buildGitHubWorkflowStages(
  effectiveConfig: CollabConfig,
  logger: Logger,
  options: InitOptions,
): OrchestrationStage[] {
  return [
    buildGitHubAuthStage(effectiveConfig, logger, options),
    githubSetupStage,
    ciSetupStage,
  ];
}
