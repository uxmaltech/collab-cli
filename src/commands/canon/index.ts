import type { Command } from 'commander';

import { registerCanonRebuildCommand } from './rebuild';

export function registerCanonCommand(program: Command): void {
  const canon = program
    .command('canon')
    .description('Manage canonical architecture artifacts')
    .addHelpText(
      'after',
      `
Examples:
  collab canon rebuild --confirm
  collab canon rebuild --confirm --indexes
  collab canon rebuild --confirm --graph --dry-run
`,
    );

  registerCanonRebuildCommand(canon);
}
