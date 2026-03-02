import { Command } from 'commander';

import { registerDoctorCommand } from './commands/doctor';
import { readCliVersion } from './lib/version';

export function createCli(): Command {
  const program = new Command();

  program
    .name('collab')
    .description('CLI for collaborative architecture and delivery workflows')
    .version(readCliVersion(), '-v, --version', 'Show CLI version')
    .showHelpAfterError(true)
    .addHelpCommand(true);

  registerDoctorCommand(program);

  return program;
}

export async function run(argv = process.argv): Promise<void> {
  const program = createCli();
  await program.parseAsync(argv);
}
