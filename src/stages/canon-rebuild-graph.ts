import {
  getMcpBaseUrl,
  resolveMcpApiKey,
  resolveMcpHeavyTimeoutMs,
  triggerGraphSeed,
} from '../lib/mcp-client';
import { loadRuntimeEnv, REBUILD_HEALTH_OPTIONS, waitForMcpHealth } from '../lib/service-health';
import { CliError } from '../lib/errors';
import type { OrchestrationStage } from '../lib/orchestrator';

export const canonRebuildGraphStage: OrchestrationStage = {
  id: 'canon-rebuild-graph',
  title: 'Rebuild NebulaGraph seeds via MCP',
  recovery: [
    'Ensure infrastructure is running: collab infra up',
    'Ensure MCP server is running: collab mcp start',
    'Run collab canon rebuild --confirm --graph to retry.',
  ],
  run: async (ctx) => {
    if (ctx.executor.dryRun) {
      ctx.logger.info('[dry-run] Would re-seed NebulaGraph via MCP HTTP endpoint.');
      return;
    }

    const env = loadRuntimeEnv(ctx.config);

    // Pre-check: is MCP reachable?
    const health = await waitForMcpHealth(env, REBUILD_HEALTH_OPTIONS);

    if (!health.ok) {
      throw new CliError(
        'MCP server is not reachable. Start it with: collab mcp start',
      );
    }

    const baseUrl = getMcpBaseUrl(ctx.config);
    const apiKey = resolveMcpApiKey(env);
    const timeoutMs = resolveMcpHeavyTimeoutMs(env);

    ctx.logger.info('Triggering NebulaGraph re-seed via MCP...');
    const result = await triggerGraphSeed(baseUrl, apiKey, timeoutMs);
    ctx.logger.info(
      `Graph re-seed complete: ${result.nodes_created} nodes, ${result.edges_created} edges.`,
    );
  },
};
