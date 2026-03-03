import fs from 'node:fs';
import path from 'node:path';

import type { OrchestrationStage, StageContext } from '../lib/orchestrator';
import { architecturePrTemplate, architectureMergeTemplate } from '../templates/ci';

export const ciSetupStage: OrchestrationStage = {
  id: 'ci-setup',
  title: 'Generate CI workflow files for architecture',
  recovery: [
    'Verify write permissions for .github/workflows/ directory.',
    'Run collab init --resume to retry CI setup.',
  ],
  run: (ctx) => {
    if (ctx.options?.skipCi) {
      ctx.logger.info('Skipping CI workflow generation by user choice.');
      return;
    }

    const workflowDir = path.join(ctx.config.workspaceDir, '.github', 'workflows');
    let created = 0;
    let skipped = 0;

    // PR workflow — both modes
    const prFile = path.join(workflowDir, 'architecture-pr.yml');
    if (!ctx.executor.dryRun && fs.existsSync(prFile)) {
      ctx.logger.debug('PR workflow already exists, skipping: architecture-pr.yml');
      skipped++;
    } else {
      ctx.executor.ensureDirectory(workflowDir);
      ctx.executor.writeFile(prFile, architecturePrTemplate, {
        description: 'write architecture PR validation workflow',
      });
      created++;
    }

    // Merge workflow — indexed mode only
    if (ctx.config.mode === 'indexed') {
      const mergeFile = path.join(workflowDir, 'architecture-merge.yml');
      if (!ctx.executor.dryRun && fs.existsSync(mergeFile)) {
        ctx.logger.debug('Merge workflow already exists, skipping: architecture-merge.yml');
        skipped++;
      } else {
        ctx.executor.ensureDirectory(workflowDir);
        ctx.executor.writeFile(mergeFile, architectureMergeTemplate, {
          description: 'write architecture merge ingestion workflow',
        });
        created++;
      }
    }

    ctx.logger.info(
      `CI workflows: ${created} file(s) created, ${skipped} existing file(s) preserved.`,
    );
  },
};
