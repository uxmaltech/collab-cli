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
import { loadGitHubAuth } from '../lib/github-auth';

export function registerUpdateCanonsCommand(program: Command): void {
  program
    .command('update-canons')
    .description('Download or update collab-architecture and business canons from GitHub')
    .action((_options: unknown, command: Command) => {
      const context = createCommandContext(command);

      // ── Framework canon ──────────────────────────────────────
      const ok = syncCanons();
      if (!ok) {
        process.exitCode = 1;
        return;
      }

      const canonsDir = getCanonsBaseDir();
      try {
        const commitInfo = execFileSync(
          'git',
          ['-C', canonsDir, 'log', '-1', '--format=%h (%ci)'],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        ).trim();
        console.log(`Framework canon up to date: ${commitInfo}`);
      } catch {
        console.log('Framework canon updated successfully.');
      }

      // ── Business canon ───────────────────────────────────────
      if (isBusinessCanonConfigured(context.config)) {
        const auth = loadGitHubAuth(context.config.collabDir);
        const token = auth?.token;

        const bizOk = syncBusinessCanon(context.config, undefined, token);
        if (!bizOk) {
          console.error('Failed to sync business canon.');
          process.exitCode = 1;
          return;
        }

        const bizDir = getBusinessCanonDir(context.config);
        try {
          const bizCommitInfo = execFileSync(
            'git',
            ['-C', bizDir, 'log', '-1', '--format=%h (%ci)'],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
          ).trim();
          console.log(`Business canon up to date: ${bizCommitInfo}`);
        } catch {
          console.log('Business canon updated successfully.');
        }
      }
    });
}
