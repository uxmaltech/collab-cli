import type { Command } from 'commander';

import { green, CHECK } from '../lib/ansi';
import { CliError } from '../lib/errors';
import { requireNpm, npmGlobalUninstall } from '../lib/npm-operations';
import { promptBoolean } from '../lib/prompt';

interface UninstallOptions {
  yes?: boolean;
}

export function registerUninstallCommand(program: Command): void {
  program
    .command('uninstall')
    .description('Uninstall collab-cli from the system')
    .option('--yes', 'Skip confirmation prompt')
    .addHelpText(
      'after',
      `
Examples:
  collab uninstall          # Uninstall with confirmation prompt
  collab uninstall --yes    # Uninstall without confirmation
`,
    )
    .action(async (options: UninstallOptions) => {
      const npmPath = requireNpm();
      if (!npmPath) {
        throw new CliError('npm not found in PATH. Cannot uninstall.');
      }

      if (!options.yes) {
        const accepted = await promptBoolean('Are you sure you want to uninstall collab-cli?', false);
        if (!accepted) {
          process.stdout.write('Uninstall cancelled.\n');
          return;
        }
      }

      process.stdout.write('Uninstalling collab-cli...\n');

      if (!npmGlobalUninstall(npmPath)) {
        throw new CliError('Uninstall failed.');
      }

      process.stdout.write(green(`${CHECK} collab-cli has been uninstalled successfully.\n`));
    });
}
