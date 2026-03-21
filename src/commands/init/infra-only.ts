import {
  defaultCollabConfig,
  type CollabConfig,
} from '../../lib/config';
import { isBusinessCanonConfigured } from '../../lib/canon-resolver';
import { CliError } from '../../lib/errors';
import type { Executor } from '../../lib/executor';
import { parseInfraType, validateMcpUrl } from '../../lib/infra-type';
import type { Logger } from '../../lib/logger';
import { runOrchestration } from '../../lib/orchestrator';

import type { InitOptions } from './types';
import { parseComposeMode, inferComposeMode } from './helpers';
import { validateMcpServerContract } from './mcp-helpers';
import { buildInfraStages, buildRemoteInfraStages } from './pipelines';

export async function runInfraOnly(
  context: { config: CollabConfig; executor: Executor; logger: Logger },
  options: InitOptions,
): Promise<void> {
  // Build a minimal config — reuse existing if available
  const effectiveConfig: CollabConfig = {
    ...defaultCollabConfig(context.config.workspaceDir),
    ...context.config,
    mode: 'indexed',
    infraType: 'local',
  };

  const infraType = options.infraType
    ? parseInfraType(options.infraType)
    : effectiveConfig.infraType ?? 'local';

  effectiveConfig.infraType = infraType;

  if (infraType === 'remote') {
    if (!options.mcpUrl) {
      throw new CliError(
        '--mcp-url is required for remote infrastructure. Example:\n' +
          '  collab init infra --infra-type remote --mcp-url http://my-server:7337',
      );
    }
    const mcpUrl = validateMcpUrl(options.mcpUrl);
    effectiveConfig.mcpUrl = mcpUrl;

    await validateMcpServerContract(mcpUrl, context.logger, context.executor.dryRun);
  }

  const composeMode = options.composeMode
    ? parseComposeMode(options.composeMode)
    : inferComposeMode(effectiveConfig);

  // Summary header
  const infraLabel = infraType === 'remote' ? 'remote' : `local (${composeMode})`;
  context.logger.phaseHeader('Infrastructure', infraLabel);

  // Pipeline
  const stages = infraType === 'remote' && effectiveConfig.mcpUrl
    ? buildRemoteInfraStages(effectiveConfig, context.executor, context.logger, options, effectiveConfig.mcpUrl)
    : buildInfraStages(effectiveConfig, context.executor, context.logger, options, composeMode);

  await runOrchestration(
    {
      workflowId: 'init:infra',
      config: effectiveConfig,
      executor: context.executor,
      logger: context.logger,
      resume: options.resume,
      mode: `indexed (infra-only, ${infraLabel})`,
      stageOptions: {
        skipGithubSetup: options.skipGithubSetup,
      },
    },
    stages,
  );

  // Summary footer
  context.logger.phaseHeader('Infrastructure Ready');

  const summaryEntries = [
    { label: 'Phase', value: 'infra-only' },
    { label: 'Infrastructure', value: infraType },
    { label: 'Dry-run', value: context.executor.dryRun ? 'yes' : 'no' },
  ];

  if (infraType === 'remote' && effectiveConfig.mcpUrl) {
    summaryEntries.push({ label: 'MCP URL', value: effectiveConfig.mcpUrl });
  } else {
    summaryEntries.push({ label: 'Compose mode', value: composeMode });
  }

  if (isBusinessCanonConfigured(effectiveConfig)) {
    summaryEntries.push({ label: 'Business canon', value: effectiveConfig.canons?.business?.repo ?? '' });
  }

  context.logger.summaryFooter(summaryEntries);
}
