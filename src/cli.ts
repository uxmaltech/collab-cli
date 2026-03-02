import { Command } from 'commander';

import { registerCommands } from './commands';
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

  registerCommands(program);

  return program;
}

export async function run(argv = process.argv): Promise<void> {
  const program = createCli();
  await program.parseAsync(argv);
}
