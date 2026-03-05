import fs from 'node:fs';
import path from 'node:path';

import { getCanonIndexTargets } from '../lib/canon-index-targets';
import type { OrchestrationStage, StageContext } from '../lib/orchestrator';

function validateIndexFiles(ctx: StageContext): string[] {
  const errors: string[] = [];
  const archDir = ctx.config.architectureDir;
  const targets = getCanonIndexTargets(archDir);

  for (const target of targets) {
    const fullPath = target.outputFile;
    const relPath = path.relative(archDir, fullPath);

    if (!fs.existsSync(fullPath)) {
      errors.push(`Missing index file: ${relPath}`);
      continue;
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    if (content.trim().length === 0) {
      errors.push(`Empty index file: ${relPath}`);
    }
  }

  return errors;
}

export const canonRebuildValidateStage: OrchestrationStage = {
  id: 'canon-rebuild-validate',
  title: 'Validate rebuilt artifacts',
  recovery: [
    'Review validation errors above.',
    'Run collab canon rebuild --confirm to retry the full rebuild.',
  ],
  run: (ctx) => {
    if (ctx.executor.dryRun) {
      ctx.logger.info('[dry-run] Would validate rebuilt canon artifacts.');
      return;
    }

    const rebuildIndexes = ctx.options?.rebuildIndexes as boolean;
    const errors: string[] = [];

    if (rebuildIndexes) {
      errors.push(...validateIndexFiles(ctx));
    }

    if (errors.length > 0) {
      ctx.logger.warn(`Validation found ${errors.length} issue(s):`);
      for (const e of errors) {
        ctx.logger.warn(`  - ${e}`);
      }
      // Warn but do not fail — missing directories may be expected
      // in workspaces that haven't scaffolded all categories yet.
    } else {
      ctx.logger.info('Post-rebuild validation passed.');
    }
  },
};
