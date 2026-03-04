import fs from 'node:fs';
import path from 'node:path';

import type { StageContext } from './orchestrator';

import {
  whatEntersTheCanonTemplate,
  implementationProcessTemplate,
  schemaVersioningTemplate,
  confidenceLevelsTemplate,
  reviewProcessTemplate,
  knowledgeAxiomsReadme,
  knowledgeDecisionsReadme,
  knowledgeConventionsReadme,
  knowledgeAntiPatternsReadme,
  domainReadme,
  contractsReadme,
  changelogTemplate,
  upgradeGuideTemplate,
  deprecatedTemplate,
} from '../templates/canon';

interface ScaffoldEntry {
  /** Relative path from architectureDir (e.g. "governance/review-process.md") */
  relativePath: string;
  content: string;
}

/**
 * Defines the complete canonical architecture scaffold tree.
 * Each entry maps a relative file path to its template content.
 */
function buildScaffoldEntries(): ScaffoldEntry[] {
  return [
    // Governance
    { relativePath: 'governance/what-enters-the-canon.md', content: whatEntersTheCanonTemplate },
    { relativePath: 'governance/implementation-process.md', content: implementationProcessTemplate },
    { relativePath: 'governance/schema-versioning.md', content: schemaVersioningTemplate },
    { relativePath: 'governance/confidence-levels.md', content: confidenceLevelsTemplate },
    { relativePath: 'governance/review-process.md', content: reviewProcessTemplate },

    // Knowledge
    { relativePath: 'knowledge/axioms/README.md', content: knowledgeAxiomsReadme },
    { relativePath: 'knowledge/decisions/README.md', content: knowledgeDecisionsReadme },
    { relativePath: 'knowledge/conventions/README.md', content: knowledgeConventionsReadme },
    { relativePath: 'knowledge/anti-patterns/README.md', content: knowledgeAntiPatternsReadme },

    // Domains
    { relativePath: 'domains/README.md', content: domainReadme },

    // Contracts
    { relativePath: 'contracts/README.md', content: contractsReadme },

    // Evolution
    { relativePath: 'evolution/changelog.md', content: changelogTemplate },
    { relativePath: 'evolution/upgrade-guide.md', content: upgradeGuideTemplate },
    { relativePath: 'evolution/deprecated.md', content: deprecatedTemplate },
  ];
}

export function generateCanonScaffold(ctx: StageContext): void {
  const archDir = ctx.config.architectureDir;
  const entries = buildScaffoldEntries();

  let created = 0;
  let skipped = 0;

  for (const entry of entries) {
    const target = path.join(archDir, entry.relativePath);

    // Never overwrite existing files — the user may have customized them.
    if (!ctx.executor.dryRun && fs.existsSync(target)) {
      ctx.logger.debug(`Scaffold file already exists, skipping: ${entry.relativePath}`);
      skipped++;
      continue;
    }

    ctx.executor.ensureDirectory(path.dirname(target));
    ctx.executor.writeFile(target, entry.content, {
      description: `scaffold ${entry.relativePath}`,
    });
    created++;
  }

  ctx.logger.info(
    `Canon scaffold: ${created} file(s) created, ${skipped} existing file(s) preserved.`,
  );
}
