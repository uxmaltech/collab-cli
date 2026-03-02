import type { Command } from 'commander';

import { registerInfraDownCommand } from './down';
import { registerInfraStatusCommand } from './status';
import { registerInfraUpCommand } from './up';

export function registerInfraCommand(program: Command): void {
  const infra = program
    .command('infra')
    .description('Manage infrastructure services used by collab')
    .addHelpText(
      'after',
      `
Examples:
  collab infra up
  collab infra down
  collab infra status
`,
    );

  registerInfraUpCommand(infra);
  registerInfraDownCommand(infra);
  registerInfraStatusCommand(infra);
}
