import { runDockerCompose } from '../lib/docker-compose';
import type { OrchestrationStage } from '../lib/orchestrator';
import { resolveMcpComposeFile } from '../commands/mcp/shared';

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

    const outputDir = ctx.options?.outputDir as string | undefined;
    const selection = resolveMcpComposeFile(ctx.config, outputDir, undefined);

    ctx.logger.info('Seeding NebulaGraph with canonical architecture graph...');

    runDockerCompose({
      executor: ctx.executor,
      files: [selection.filePath],
      arguments: ['exec', 'mcp', 'node', 'scripts/seed-graph.mjs'],
      cwd: ctx.config.workspaceDir,
    });

    ctx.logger.info('NebulaGraph seeding complete.');
  },
};
