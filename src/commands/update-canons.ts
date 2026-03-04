import { execFileSync } from 'node:child_process';

import type { Command } from 'commander';

import { getCanonsBaseDir, syncCanons } from '../lib/canon-resolver';

export function registerUpdateCanonsCommand(program: Command): void {
  program
    .command('update-canons')
    .description('Download or update the collab-architecture canons from GitHub')
    .action(() => {
      const ok = syncCanons();
      if (!ok) {
        process.exitCode = 1;
        return;
      }

      // Show latest commit info
      const canonsDir = getCanonsBaseDir();
      try {
        const commitInfo = execFileSync(
          'git',
          ['-C', canonsDir, 'log', '-1', '--format=%h (%ci)'],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        ).trim();
        console.log(`Canons up to date: ${commitInfo}`);
      } catch {
        console.log('Canons updated successfully.');
      }
    });
}
