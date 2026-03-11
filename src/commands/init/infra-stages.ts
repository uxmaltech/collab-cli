import path from 'node:path';

import type { CollabConfig } from '../../lib/config';
import type { ComposeMode } from '../../lib/compose-paths';
import { assertComposeFilesValid } from '../../lib/compose-validator';
import { generateComposeFiles } from '../../lib/compose-renderer';
import { CliError } from '../../lib/errors';
import type { Executor } from '../../lib/executor';
import type { Logger } from '../../lib/logger';
import type { OrchestrationStage } from '../../lib/orchestrator';
import { parseNumber } from '../../lib/parsers';
import { getEnabledProviders, PROVIDER_DEFAULTS } from '../../lib/providers';
import { resolveInfraComposeFile, runInfraCompose } from '../infra/shared';
import { resolveMcpComposeFile, runMcpCompose } from '../mcp/shared';
import { dryRunHealthOptions, loadRuntimeEnv, waitForInfraHealth, waitForMcpHealth, logServiceHealth } from '../../lib/service-health';

import { canonIngestStage } from '../../stages/canon-ingest';
import { graphSeedStage } from '../../stages/graph-seed';
import { githubSetupStage } from '../../stages/github-setup';

import type { InitOptions } from './types';
import { renderMcpSnippet } from './mcp-helpers';

function buildMcpClientConfigStage(
  effectiveConfig: CollabConfig,
  executor: Executor,
  logger: Logger,
  options: InitOptions,
): OrchestrationStage {
  return {
    id: 'mcp-client-config',
    title: 'Generate MCP client config snippets',
    recovery: [
      'Verify permissions in .collab directory.',
      'Run collab init --resume to regenerate MCP config snippets.',
    ],
    run: () => {
      if (options.skipMcpSnippets) {
        logger.info('Skipping MCP snippet generation by user choice.');
        return;
      }

      const enabled = getEnabledProviders(effectiveConfig);
      if (enabled.length === 0) {
        logger.info('No providers configured; skipping MCP snippet generation.');
        return;
      }

      for (const provider of enabled) {
        const snippet = renderMcpSnippet(provider, effectiveConfig);
        if (!snippet) continue;
        const target = path.join(effectiveConfig.collabDir, snippet.filename);
        executor.writeFile(target, snippet.content, {
          description: `write ${PROVIDER_DEFAULTS[provider].label} MCP config snippet`,
        });
      }

      logger.info(
        `Generated MCP snippets for: ${enabled.map((k) => PROVIDER_DEFAULTS[k].label).join(', ')}`,
      );
    },
  };
}

export function buildInfraStages(
  effectiveConfig: CollabConfig,
  executor: Executor,
  logger: Logger,
  options: InitOptions,
  composeMode: ComposeMode,
): OrchestrationStage[] {
  const health = {
    timeoutMs: parseNumber(options.timeoutMs, 5_000),
    retries: parseNumber(options.retries, 15),
    retryDelayMs: parseNumber(options.retryDelayMs, 2_000),
  };

  return [
    {
      id: 'compose-generation',
      title: 'Generate and validate compose files',
      recovery: [
        'Run collab compose validate to inspect configuration errors.',
        'Run collab init --resume after fixing compose inputs.',
      ],
      run: () => {
        const generation = generateComposeFiles({
          config: effectiveConfig,
          mode: composeMode,
          outputDirectory: options.outputDir,
          logger,
          executor,
        });

        for (const warning of generation.driftWarnings) {
          logger.warn(warning);
        }

        assertComposeFilesValid(
          generation.files.map((file) => file.filePath),
          effectiveConfig.workspaceDir,
          executor,
        );
      },
    },
    {
      id: 'infra-start',
      title: 'Start infrastructure services',
      recovery: [
        'Run collab infra status to inspect Qdrant and Nebula.',
        'Run collab init --resume after infra services are healthy.',
      ],
      run: async () => {
        const env = loadRuntimeEnv(effectiveConfig);
        const probe = await waitForInfraHealth(env, { ...health, retries: 1 });
        if (probe.ok) {
          logger.info('Infrastructure already running — skipping docker compose up.');
          logServiceHealth(logger, 'infra health', probe);
          return;
        }
        const selection = resolveInfraComposeFile(effectiveConfig, options.outputDir, undefined);
        await runInfraCompose(logger, executor, effectiveConfig, selection, 'up', { health });
      },
    },
    {
      id: 'mcp-start',
      title: 'Start MCP service',
      recovery: [
        'Run collab mcp status to inspect MCP runtime.',
        'Run collab init --resume after MCP health endpoint responds.',
      ],
      run: async () => {
        // Always run `docker compose up -d` so the container picks up any .env
        // changes (e.g. new MCP_TECHNICAL_SCOPES from workspace repos).
        // Docker Compose recreates only when configuration actually changed.
        const selection = resolveMcpComposeFile(effectiveConfig, options.outputDir, undefined);
        await runMcpCompose(logger, executor, effectiveConfig, selection, 'up', { health });
      },
    },
    buildMcpClientConfigStage(effectiveConfig, executor, logger, options),
    graphSeedStage,
    canonIngestStage,
    githubSetupStage,
  ];
}

export function buildRemoteInfraStages(
  effectiveConfig: CollabConfig,
  executor: Executor,
  logger: Logger,
  options: InitOptions,
  mcpUrl: string,
): OrchestrationStage[] {
  const health = dryRunHealthOptions(executor, {
    timeoutMs: parseNumber(options.timeoutMs, 5_000),
    retries: parseNumber(options.retries, 15),
    retryDelayMs: parseNumber(options.retryDelayMs, 2_000),
  });

  return [
    {
      id: 'mcp-health-check',
      title: 'Verify remote MCP service health',
      recovery: [
        'Check that the remote MCP server is running and accessible.',
        'Verify the --mcp-url value points to a healthy MCP endpoint.',
        'Run collab init --resume after fixing remote connectivity.',
      ],
      run: async () => {
        const parsed = new URL(mcpUrl);
        const env: Record<string, string> = {
          MCP_HOST: parsed.hostname,
          MCP_PORT: parsed.port || (parsed.protocol === 'https:' ? '443' : '80'),
        };
        const probe = await waitForMcpHealth(env, health);
        if (!probe.ok) {
          throw new CliError(`Remote MCP is not healthy at ${mcpUrl}: ${probe.errors.join(', ')}`);
        }
        logServiceHealth(logger, 'remote MCP health', probe);
      },
    },
    buildMcpClientConfigStage(effectiveConfig, executor, logger, options),
    graphSeedStage,
    canonIngestStage,
    githubSetupStage,
  ];
}
