import { execFileSync } from 'node:child_process';

import type { Command } from 'commander';

import { green, red, yellow, CHECK, CROSS } from '../lib/ansi';
import { resolveCommandPath } from '../lib/shell';
import { fetchLatestVersion, checkForUpdate } from '../lib/update-checker';
import { readCliVersion } from '../lib/version';

import semver from 'semver';

interface UpgradeOptions {
  check?: boolean;
}

export function registerUpgradeCommand(program: Command): void {
  program
    .command('upgrade')
    .description('Check for and install the latest version of collab-cli')
    .option('--check', 'Only check for updates without installing')
    .addHelpText(
      'after',
      `
Examples:
  collab upgrade            # Upgrade to the latest version
  collab upgrade --check    # Check for updates without installing
`,
    )
    .action(async (options: UpgradeOptions) => {
      const currentVersion = readCliVersion();

      process.stdout.write(`Current version: ${currentVersion}\n`);
      process.stdout.write('Checking for updates...\n');

      const latestVersion = await fetchLatestVersion();

      if (!latestVersion) {
        process.stderr.write(red(`${CROSS} Unable to reach npm registry. Check your internet connection.\n`));
        process.exitCode = 1;
        return;
      }

      const updateAvailable = semver.gt(latestVersion, currentVersion);

      if (!updateAvailable) {
        process.stdout.write(green(`${CHECK} collab-cli is up to date (v${currentVersion})\n`));

        // Persist state so the daily check won't re-query unnecessarily
        await checkForUpdate();
        return;
      }

      process.stdout.write(yellow(`Update available: ${currentVersion} → ${latestVersion}\n`));

      if (options.check) {
        process.stdout.write(`Run ${green('collab upgrade')} to install the update.\n`);
        return;
      }

      // ── Perform the upgrade ────────────────────────────────────
      const npmPath = resolveCommandPath('npm');
      if (!npmPath) {
        process.stderr.write(red(`${CROSS} npm not found in PATH. Install Node.js/npm first.\n`));
        process.exitCode = 1;
        return;
      }

      process.stdout.write(`Upgrading collab-cli: ${currentVersion} → ${latestVersion}...\n`);

      try {
        execFileSync(npmPath, ['install', '-g', `@uxmaltech/collab-cli@${latestVersion}`], {
          stdio: 'inherit',
          timeout: 60_000,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (/EACCES|permission denied/i.test(message)) {
          process.stderr.write(
            red(`${CROSS} Permission denied. Try:\n`) +
            `  sudo npm install -g @uxmaltech/collab-cli@${latestVersion}\n`,
          );
        } else {
          process.stderr.write(red(`${CROSS} Upgrade failed: ${message}\n`));
        }
        process.exitCode = 1;
        return;
      }

      process.stdout.write(green(`${CHECK} Successfully upgraded to v${latestVersion}\n`));

      // Update the check state so the daily banner won't fire
      await checkForUpdate();
    });
}
