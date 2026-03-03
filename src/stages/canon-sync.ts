import { copyCanonContent, isCanonsAvailable, syncCanons } from '../lib/canon-resolver';
import type { OrchestrationStage } from '../lib/orchestrator';

export const canonSyncStage: OrchestrationStage = {
  id: 'canon-sync',
  title: 'Sync canonical architecture',
  recovery: [
    'Verify internet connectivity for git clone/pull.',
    'Run collab update-canons manually, then collab init --resume.',
  ],
  run: (ctx) => {
    if (ctx.executor.dryRun) {
      ctx.logger.info('[dry-run] Would sync canons and copy to uxmaltech/.');
      return;
    }

    // Ensure canons are available locally (clone or pull)
    if (!isCanonsAvailable()) {
      ctx.logger.info('Canons not installed. Downloading collab-architecture...');
    }

    const ok = syncCanons((msg) => ctx.logger.info(msg));
    if (!ok || !isCanonsAvailable()) {
      throw new Error('Failed to sync collab-architecture canons. Check git access and connectivity.');
    }

    // Copy full canon content to docs/architecture/uxmaltech/
    const targetDir = ctx.config.uxmaltechDir;
    ctx.logger.info(`Copying canon content to ${targetDir}...`);

    const fileCount = copyCanonContent(targetDir, (msg) => ctx.logger.debug(msg));
    ctx.logger.info(`Canon sync complete: ${fileCount} file(s) copied to uxmaltech/.`);
  },
};
