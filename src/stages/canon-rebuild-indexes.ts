import path from 'node:path';

import { scanCanonEntries, generateIndexReadme } from '../lib/canon-index-generator';
import type { OrchestrationStage } from '../lib/orchestrator';

interface IndexTarget {
  scanDir: string;
  outputFile: string;
  sectionTitle: string;
  description: string;
}

function buildIndexTargets(archDir: string): IndexTarget[] {
  return [
    {
      scanDir: path.join(archDir, 'knowledge', 'axioms'),
      outputFile: path.join(archDir, 'knowledge', 'axioms', 'README.md'),
      sectionTitle: 'Axioms',
      description: 'Fundamental architectural invariants that MUST always hold.',
    },
    {
      scanDir: path.join(archDir, 'knowledge', 'decisions'),
      outputFile: path.join(archDir, 'knowledge', 'decisions', 'README.md'),
      sectionTitle: 'Architectural Decisions',
      description: 'ADRs documenting key architectural choices and their rationale.',
    },
    {
      scanDir: path.join(archDir, 'knowledge', 'conventions'),
      outputFile: path.join(archDir, 'knowledge', 'conventions', 'README.md'),
      sectionTitle: 'Conventions',
      description: 'Coding and design conventions followed across this codebase.',
    },
    {
      scanDir: path.join(archDir, 'knowledge', 'anti-patterns'),
      outputFile: path.join(archDir, 'knowledge', 'anti-patterns', 'README.md'),
      sectionTitle: 'Anti-Patterns',
      description: 'Known pitfalls and patterns that MUST be avoided.',
    },
    {
      scanDir: path.join(archDir, 'domains'),
      outputFile: path.join(archDir, 'domains', 'README.md'),
      sectionTitle: 'Domains',
      description: 'Bounded contexts and domain boundaries identified in the architecture.',
    },
    {
      scanDir: path.join(archDir, 'contracts'),
      outputFile: path.join(archDir, 'contracts', 'README.md'),
      sectionTitle: 'Contracts',
      description: 'Interface contracts between domains (UI-backend shapes, command outcomes).',
    },
  ];
}

export const canonRebuildIndexesStage: OrchestrationStage = {
  id: 'canon-rebuild-indexes',
  title: 'Regenerate canon index files',
  recovery: [
    'Verify write permissions for the architecture directory.',
    'Run collab canon rebuild --confirm --indexes to retry.',
  ],
  run: (ctx) => {
    const archDir = ctx.config.architectureDir;
    const targets = buildIndexTargets(archDir);

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
