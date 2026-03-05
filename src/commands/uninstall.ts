import { execFileSync } from 'node:child_process';
import readline from 'node:readline';

import type { Command } from 'commander';

import { green, red, yellow, CHECK, CROSS } from '../lib/ansi';
import { resolveCommandPath } from '../lib/shell';

interface UninstallOptions {
  yes?: boolean;
}

async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });

  return new Promise((resolve) => {
    rl.question(`${yellow(message)} (y/N) `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
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
      const npmPath = resolveCommandPath('npm');
      if (!npmPath) {
        process.stderr.write(red(`${CROSS} npm not found in PATH. Cannot uninstall.\n`));
        process.exitCode = 1;
        return;
      }

      if (!options.yes) {
        const accepted = await confirm('Are you sure you want to uninstall collab-cli?');
        if (!accepted) {
          process.stdout.write('Uninstall cancelled.\n');
          return;
        }
      }

      process.stdout.write('Uninstalling collab-cli...\n');

      try {
        execFileSync(npmPath, ['uninstall', '-g', '@uxmaltech/collab-cli'], {
          stdio: 'inherit',
          timeout: 60_000,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (/EACCES|permission denied/i.test(message)) {
          process.stderr.write(
            red(`${CROSS} Permission denied. Try:\n`) +
            '  sudo npm uninstall -g @uxmaltech/collab-cli\n',
          );
        } else {
          process.stderr.write(red(`${CROSS} Uninstall failed: ${message}\n`));
        }
        process.exitCode = 1;
        return;
      }

      process.stdout.write(green(`${CHECK} collab-cli has been uninstalled successfully.\n`));
    });
}
