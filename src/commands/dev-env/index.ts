import type { Command } from 'commander';

import { registerDevEnvStartCommand } from './start';
import { registerDevEnvStopCommand } from './stop';

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
  collab dev-env stop
`,
    );

  registerDevEnvStartCommand(devEnv);
  registerDevEnvStopCommand(devEnv);
}
