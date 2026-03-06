import fs from 'node:fs';
import path from 'node:path';

import { resolveRepoConfigs } from '../lib/config';
import { configureRepo, resolveGitHubOwnerRepo } from '../lib/github-api';
import { loadGitHubAuth } from '../lib/github-auth';
import { CliError } from '../lib/errors';
import type { OrchestrationStage, StageContext } from '../lib/orchestrator';
import { guardMainPrTemplate } from '../templates/ci/guard-main-pr';
import { canonSyncTriggerTemplate } from '../templates/ci/canon-sync-trigger';

/**
 * Configures GitHub repos: branch model, protection, merge strategy,
 * guard-main-pr workflow, canon-sync-trigger workflow, and CANON_SYNC_PAT secret.
 *
 * Only runs in indexed mode. Skipped with `--skip-github-setup`.
 */
export const githubSetupStage: OrchestrationStage = {
  id: 'github-setup',
  title: 'Configure GitHub branch model, protections, and automation workflows',
  recovery: [
    'Ensure GitHub token has repo scope.',
    'Run collab init --resume to retry GitHub setup.',
    'Use --skip-github-setup to bypass this stage.',
  ],
  run: async (ctx: StageContext) => {
    if (ctx.options?.skipGithubSetup) {
      ctx.logger.info('Skipping GitHub setup by user choice.');
      return;
    }

    if (ctx.config.mode !== 'indexed') {
      ctx.logger.info('GitHub setup is only available in indexed mode; skipping.');
      return;
    }

    if (ctx.executor.dryRun) {
      ctx.logger.info('[dry-run] Would configure GitHub branch model, protections, and workflows for workspace repos.');
      return;
    }

    // Load GitHub token
    const auth = loadGitHubAuth(ctx.config.collabDir);
    if (!auth) {
      throw new CliError(
        'GitHub authorization required but token not found.\n' +
          'Run collab init --resume after authenticating with GitHub.',
      );
    }
    const { token } = auth;

    // Resolve business canon slug
    const canonSlug = ctx.config.canons?.business?.repo;

    // Configure governed repos
    const repoConfigs = resolveRepoConfigs(ctx.config);

    for (const rc of repoConfigs) {
      const identity = resolveGitHubOwnerRepo(rc.repoDir);
      if (!identity) {
        ctx.logger.warn(`Skipping "${rc.name}": no GitHub origin remote.`);
        continue;
      }

      // Branch model + protection + merge strategy
      await configureRepo(identity.slug, token, ctx.logger);

      // guard-main-pr.yml
      const guardPath = path.join(rc.repoDir, '.github', 'workflows', 'guard-main-pr.yml');
      if (!fs.existsSync(guardPath)) {
        ctx.executor.writeFile(guardPath, guardMainPrTemplate, {
          description: `write guard-main-pr workflow for ${rc.name}`,
        });
        ctx.logger.info(`  Created guard-main-pr.yml for ${rc.name}.`);
      } else {
        ctx.logger.info(`  guard-main-pr.yml already exists for ${rc.name}; skipping.`);
      }

      // canon-sync-trigger.yml (only for governed repos, not the canon itself)
      if (canonSlug && identity.slug !== canonSlug) {
        const triggerPath = path.join(rc.repoDir, '.github', 'workflows', 'canon-sync-trigger.yml');
        if (!fs.existsSync(triggerPath)) {
          ctx.executor.writeFile(triggerPath, canonSyncTriggerTemplate(canonSlug), {
            description: `write canon-sync-trigger workflow for ${rc.name}`,
          });
          ctx.logger.info(`  Created canon-sync-trigger.yml for ${rc.name}.`);
        } else {
          ctx.logger.info(`  canon-sync-trigger.yml already exists for ${rc.name}; skipping.`);
        }

        // CANON_SYNC_PAT secret via gh CLI (passed via stdin for security)
        try {
          ctx.executor.run('gh', [
            'secret', 'set', 'CANON_SYNC_PAT',
            '-R', identity.slug,
          ], { check: true, input: token });
          ctx.logger.info(`  Set CANON_SYNC_PAT secret for ${identity.slug}.`);
        } catch {
          ctx.logger.warn(
            `  Could not set CANON_SYNC_PAT for ${identity.slug}.\n` +
              `  Set it manually: gh secret set CANON_SYNC_PAT -R ${identity.slug}`,
          );
        }
      }
    }

    // Configure business-canon repo (same branch model, but no canon-sync-trigger)
    if (canonSlug) {
      ctx.logger.info(`Configuring business-canon repo: ${canonSlug}...`);
      await configureRepo(canonSlug, token, ctx.logger);

      // guard-main-pr.yml for the canon repo (write to local clone if available)
      const canonLocalDir = ctx.config.canons?.business?.localDir;
      if (canonLocalDir) {
        const canonRepoDir = path.join(ctx.config.architectureDir, canonLocalDir);
        const guardPath = path.join(canonRepoDir, '.github', 'workflows', 'guard-main-pr.yml');
        if (fs.existsSync(canonRepoDir) && !fs.existsSync(guardPath)) {
          ctx.executor.writeFile(guardPath, guardMainPrTemplate, {
            description: `write guard-main-pr workflow for business-canon`,
          });
          ctx.logger.info(`  Created guard-main-pr.yml for business-canon.`);
        }
      }
    }

    ctx.logger.info('GitHub setup complete.');
  },
};
