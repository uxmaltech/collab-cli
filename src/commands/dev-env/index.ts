import type { Command } from 'commander';

import { registerDevEnvStartCommand } from './start';

export function registerDevEnvCommand(program: Command): void {
  const devEnv = program
    .command('dev-env')
    .description('Manage the local development environment required by born agents')
    .addHelpText(
      'after',
      `
Examples:
  collab dev-env start
  collab dev-env start --source-architecture-mcp ../collab-architecture-mcp
`,
    );

  registerDevEnvStartCommand(devEnv);
}
