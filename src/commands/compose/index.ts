import type { Command } from 'commander';

import { registerComposeGenerateCommand } from './generate';
import { registerComposeValidateCommand } from './validate';

export function registerComposeCommand(program: Command): void {
  const composeCommand = program
    .command('compose')
    .description('Generate and validate Docker Compose files')
    .addHelpText(
      'after',
      `
Examples:
  collab compose generate --mode consolidated
  collab compose generate --mode split
  collab compose validate --mode auto
`,
    );

  registerComposeGenerateCommand(composeCommand);
  registerComposeValidateCommand(composeCommand);
}
