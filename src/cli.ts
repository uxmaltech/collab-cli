import { Command } from 'commander';

import { registerCommands } from './commands';
import { maybeNotifyUpdate } from './lib/update-checker';
import { readCliVersion } from './lib/version';

export function createCli(): Command {
  const program = new Command();

  program
    .name('collab')
    .description('CLI for collaborative architecture and delivery workflows')
    .version(readCliVersion(), '-v, --version', 'Show CLI version')
    .option('--cwd <path>', 'Working directory for collab operations')
    .option('--dry-run', 'Preview actions without side effects')
    .option('--verbose', 'Enable verbose command logging')
    .option('--quiet', 'Reduce output to results and errors')
    .showHelpAfterError(true)
    .addHelpCommand(true);

  // Daily update check — shows a non-blocking banner if a new version is available.
  // Skips the upgrade command itself (it does its own check).
  program.hook('preAction', async (_thisCommand, actionCommand) => {
    if (actionCommand.name() === 'upgrade') return;
    await maybeNotifyUpdate();
  });

  registerCommands(program);

  return program;
}

export async function run(argv = process.argv): Promise<void> {
  const program = createCli();
  await program.parseAsync(argv);
}
