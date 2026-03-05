import fs from 'node:fs';
import path from 'node:path';

import type { OrchestrationStage, StageContext } from '../lib/orchestrator';

/**
 * Recursively copies files from sourceDir into snapshotDir using the executor.
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

/** Relative paths of index README files to snapshot. */
const INDEX_FILES = [
  'README.md',
  'knowledge/README.md',
  'knowledge/axioms/README.md',
  'knowledge/decisions/README.md',
  'knowledge/conventions/README.md',
  'knowledge/anti-patterns/README.md',
  'domains/README.md',
  'contracts/README.md',
];

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

    // Snapshot index README files
    for (const relPath of INDEX_FILES) {
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
