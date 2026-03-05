import { loadRuntimeEnv, REBUILD_HEALTH_OPTIONS, waitForMcpHealth } from '../lib/service-health';
import { CliError } from '../lib/errors';
import type { OrchestrationStage } from '../lib/orchestrator';
import { ingestCanonFiles } from './canon-ingest';

export const canonRebuildVectorsStage: OrchestrationStage = {
  id: 'canon-rebuild-vectors',
  title: 'Rebuild vector embeddings via MCP',
  recovery: [
    'Ensure infrastructure is running: collab infra up',
    'Ensure MCP server is running: collab mcp start',
    'Run collab canon rebuild --confirm --vectors to retry.',
  ],
  run: async (ctx) => {
    if (ctx.executor.dryRun) {
      ctx.logger.info('[dry-run] Would re-ingest all canon files into Qdrant via MCP HTTP.');
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

    ctx.logger.info('Re-ingesting all canon files into Qdrant vector store...');
    await ingestCanonFiles(ctx);
    ctx.logger.info('Vector embedding rebuild complete.');
  },
};
