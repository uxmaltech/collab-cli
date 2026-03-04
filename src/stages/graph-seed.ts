import type { OrchestrationStage } from '../lib/orchestrator';

/** Container name for the MCP service — matches the compose template. */
const MCP_CONTAINER = 'collab-mcp';

export const graphSeedStage: OrchestrationStage = {
  id: 'graph-seed',
  title: 'Seed NebulaGraph knowledge graph',
  recovery: [
    'Ensure MCP and NebulaGraph containers are running.',
    'Run collab init --resume to retry graph seeding.',
  ],
  run: (ctx) => {
    if (ctx.executor.dryRun) {
      ctx.logger.info('[dry-run] Would seed NebulaGraph with canonical knowledge graph.');
      return;
    }

    ctx.logger.info('Seeding NebulaGraph with canonical architecture graph...');

    // Use `docker exec` directly against the well-known container name so the
    // command succeeds regardless of which compose project started the container.
    ctx.executor.run('docker', ['exec', MCP_CONTAINER, 'node', 'scripts/seed-graph.mjs']);

    ctx.logger.info('NebulaGraph seeding complete.');
  },
};
