import path from 'node:path';

import {
  copyCanonContent,
  copyBusinessCanonContent,
  isCanonsAvailable,
  isBusinessCanonConfigured,
  syncCanons,
  syncBusinessCanon,
} from '../lib/canon-resolver';
import { loadGitHubAuth } from '../lib/github-auth';
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

    // ── Framework canon ──────────────────────────────────────
    if (!isCanonsAvailable()) {
      ctx.logger.info('Canons not installed. Downloading collab-architecture...');
    }

    const ok = syncCanons((msg) => ctx.logger.info(msg));
    if (!ok || !isCanonsAvailable()) {
      throw new Error('Failed to sync collab-architecture canons. Check git access and connectivity.');
    }

    const targetDir = ctx.config.uxmaltechDir;
    ctx.logger.info(`Copying framework canon to ${targetDir}...`);

    const fileCount = copyCanonContent(targetDir, (msg) => ctx.logger.debug(msg));
    ctx.logger.info(`Framework canon sync: ${fileCount} file(s) copied to uxmaltech/.`);

    // ── Business canon ───────────────────────────────────────
    if (isBusinessCanonConfigured(ctx.config)) {
      const auth = loadGitHubAuth(ctx.config.collabDir);
      const token = auth?.token;

      const bizOk = syncBusinessCanon(ctx.config, (msg) => ctx.logger.info(msg), token);
      if (!bizOk) {
        throw new Error('Failed to sync business canon. Check repo access and connectivity.');
      }

      const localDir = ctx.config.canons?.business?.localDir ?? 'business';
      const bizTargetDir = path.join(ctx.config.architectureDir, localDir);
      ctx.logger.info(`Copying business canon to ${bizTargetDir}...`);

      const bizFileCount = copyBusinessCanonContent(ctx.config, bizTargetDir, (msg) => ctx.logger.debug(msg));
      ctx.logger.info(`Business canon sync: ${bizFileCount} file(s) copied to ${localDir}/.`);
    }
  },
};
