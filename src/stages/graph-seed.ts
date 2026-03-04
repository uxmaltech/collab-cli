import { getMcpBaseUrl, triggerGraphSeed } from '../lib/mcp-client';
import { loadRuntimeEnv } from '../lib/service-health';
import type { OrchestrationStage } from '../lib/orchestrator';

export const graphSeedStage: OrchestrationStage = {
  id: 'graph-seed',
  title: 'Seed NebulaGraph knowledge graph',
  recovery: [
    'Ensure MCP service is running and accessible.',
    'Run collab init --resume to retry graph seeding.',
  ],
  run: async (ctx) => {
    if (ctx.executor.dryRun) {
      ctx.logger.info('[dry-run] Would seed NebulaGraph with canonical knowledge graph via HTTP.');
      return;
    }

    ctx.logger.info('Seeding NebulaGraph with canonical architecture graph via HTTP...');

    const baseUrl = getMcpBaseUrl(ctx.config);
    const env = loadRuntimeEnv(ctx.config);
    const apiKey = env.MCP_API_KEYS || undefined;

    const result = await triggerGraphSeed(baseUrl, apiKey);
    ctx.logger.info(
      `NebulaGraph seeding complete: ${result.nodes_created} nodes, ${result.edges_created} edges.`,
    );
  },
};
