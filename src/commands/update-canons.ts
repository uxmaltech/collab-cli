import { execFileSync } from 'node:child_process';

import type { Command } from 'commander';

import { createCommandContext } from '../lib/command-context';
import {
  getCanonsBaseDir,
  getBusinessCanonDir,
  isBusinessCanonConfigured,
  syncCanons,
  syncBusinessCanon,
} from '../lib/canon-resolver';
import { CliError } from '../lib/errors';
import { loadGitHubAuth } from '../lib/github-auth';

/** Git log format used to display the latest commit info after sync. */
const COMMIT_FORMAT = '%h (%ci)';

export function registerUpdateCanonsCommand(program: Command): void {
  program
    .command('update-canons')
    .description('Download or update collab-architecture and business canons from GitHub')
    .action((_options: unknown, command: Command) => {
      const context = createCommandContext(command);

      // ── Framework canon ──────────────────────────────────────
      const ok = syncCanons((msg) => context.logger.info(msg));
      if (!ok) {
        throw new CliError('Failed to sync framework canon.');
      }

      const canonsDir = getCanonsBaseDir();
      try {
        const commitInfo = execFileSync(
          'git',
          ['-C', canonsDir, 'log', '-1', `--format=${COMMIT_FORMAT}`],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        ).trim();
        context.logger.info(`Framework canon up to date: ${commitInfo}`);
      } catch {
        context.logger.info('Framework canon updated successfully.');
      }

      // ── Business canon ───────────────────────────────────────
      if (isBusinessCanonConfigured(context.config)) {
        const canon = context.config.canons?.business;
        const auth = loadGitHubAuth(context.config.collabDir);
        const token = auth?.token;

        const bizOk = syncBusinessCanon(context.config, (msg) => context.logger.info(msg), token);
        if (!bizOk) {
          throw new CliError('Failed to sync business canon.');
        }

        // Show git log only for GitHub-sourced canons (local dirs may not be git repos)
        if (canon?.source !== 'local') {
          const bizDir = getBusinessCanonDir(context.config);
          try {
            const bizCommitInfo = execFileSync(
              'git',
              ['-C', bizDir, 'log', '-1', `--format=${COMMIT_FORMAT}`],
              { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
            ).trim();
            context.logger.info(`Business canon up to date: ${bizCommitInfo}`);
          } catch {
            context.logger.info('Business canon updated successfully.');
          }
        }
      }
    });
}
