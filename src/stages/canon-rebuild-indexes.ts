import path from 'node:path';

import { scanCanonEntries, generateIndexReadme } from '../lib/canon-index-generator';
import { getCanonIndexTargets } from '../lib/canon-index-targets';
import type { OrchestrationStage } from '../lib/orchestrator';

export const canonRebuildIndexesStage: OrchestrationStage = {
  id: 'canon-rebuild-indexes',
  title: 'Regenerate canon index files',
  recovery: [
    'Verify write permissions for the architecture directory.',
    'Run collab canon rebuild --confirm --indexes to retry.',
  ],
  run: (ctx) => {
    const archDir = ctx.config.architectureDir;
    const targets = getCanonIndexTargets(archDir);

    if (ctx.executor.dryRun) {
      ctx.logger.info(`[dry-run] Would regenerate ${targets.length} index files under ${archDir}.`);
      for (const t of targets) {
        ctx.logger.info(`  ${path.relative(archDir, t.outputFile)}`);
      }
      return;
    }

    let regenerated = 0;
    for (const target of targets) {
      const entries = scanCanonEntries(target.scanDir);
      const content = generateIndexReadme(target.sectionTitle, target.description, entries);
      ctx.executor.ensureDirectory(path.dirname(target.outputFile));
      ctx.executor.writeFile(target.outputFile, content, {
        description: `rebuild index ${target.sectionTitle}`,
      });
      ctx.logger.info(
        `Rebuilt ${path.relative(archDir, target.outputFile)} (${entries.length} entries)`,
      );
      regenerated++;
    }

    ctx.logger.info(`Index rebuild complete: ${regenerated} files regenerated.`);
  },
};
