import fs from 'node:fs';
import path from 'node:path';

import { getSnapshotIndexPaths } from '../lib/canon-index-targets';
import type { OrchestrationStage, StageContext } from '../lib/orchestrator';

/**
 * Recursively copies files from sourceDir into snapshotDir using the executor.
 * Reads go through `fs` directly (the Executor API only wraps side-effect
 * operations: commands, writes, mkdirs), writes go through `ctx.executor`.
 * Returns the number of files copied.
 */
function snapshotDirectory(
  sourceDir: string,
  snapshotDir: string,
  ctx: StageContext,
): number {
  if (!fs.existsSync(sourceDir)) return 0;

  let count = 0;
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const src = path.join(sourceDir, entry.name);
    const dest = path.join(snapshotDir, entry.name);

    if (entry.isDirectory()) {
      ctx.executor.ensureDirectory(dest);
      count += snapshotDirectory(src, dest, ctx);
    } else if (entry.isFile()) {
      const content = fs.readFileSync(src, 'utf8');
      ctx.executor.writeFile(dest, content, { description: `snapshot ${entry.name}` });
      count++;
    }
  }

  return count;
}

export const canonRebuildSnapshotStage: OrchestrationStage = {
  id: 'canon-rebuild-snapshot',
  title: 'Create pre-rebuild snapshot',
  recovery: [
    'Check .collab/snapshots/ for existing snapshots.',
  ],
  run: (ctx) => {
    if (ctx.executor.dryRun) {
      ctx.logger.info('[dry-run] Would create snapshot of current canon artifacts.');
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotBase = path.join(ctx.config.collabDir, 'snapshots', timestamp);
    ctx.executor.ensureDirectory(snapshotBase);

    let totalFiles = 0;

    // Snapshot index README files (derived from shared canon-index-targets)
    const indexPaths = getSnapshotIndexPaths(ctx.config.architectureDir);
    for (const relPath of indexPaths) {
      const src = path.join(ctx.config.architectureDir, relPath);
      if (fs.existsSync(src)) {
        const dest = path.join(snapshotBase, 'indexes', relPath);
        ctx.executor.ensureDirectory(path.dirname(dest));
        ctx.executor.writeFile(dest, fs.readFileSync(src, 'utf8'), {
          description: `snapshot index ${relPath}`,
        });
        totalFiles++;
      }
    }

    // Snapshot graph seed files (indexed mode only)
    if (ctx.config.mode === 'indexed') {
      const graphSeedDir = path.join(ctx.config.uxmaltechDir, 'graph', 'seed');
      if (fs.existsSync(graphSeedDir)) {
        const snapshotGraphDir = path.join(snapshotBase, 'graph-seed');
        ctx.executor.ensureDirectory(snapshotGraphDir);
        totalFiles += snapshotDirectory(graphSeedDir, snapshotGraphDir, ctx);
      }
    }

    ctx.logger.info(`Snapshot created: ${snapshotBase} (${totalFiles} file(s))`);
  },
};
