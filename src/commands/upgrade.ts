import type { Command } from 'commander';
import semver from 'semver';

import { green, yellow, CHECK } from '../lib/ansi';
import { CliError } from '../lib/errors';
import { requireNpm, npmGlobalInstall } from '../lib/npm-operations';
import { fetchLatestVersion, checkForUpdate } from '../lib/update-checker';
import { readCliVersion } from '../lib/version';

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
  collab upgrade              # Upgrade to the latest version
  collab upgrade --check      # Check for updates without installing
`,
    )
    .action(async (options: UpgradeOptions) => {
      const currentVersion = readCliVersion();

      process.stdout.write(`Current version: ${currentVersion}\n`);
      process.stdout.write('Checking for updates...\n');

      const latestVersion = await fetchLatestVersion();

      if (!latestVersion) {
        throw new CliError('Unable to reach npm registry. Check your internet connection.');
      }

      const updateAvailable = semver.gt(latestVersion, currentVersion);

      if (!updateAvailable) {
        process.stdout.write(green(`${CHECK} collab-cli is up to date (v${currentVersion})\n`));
        await checkForUpdate();
        return;
      }

      process.stdout.write(yellow(`Update available: ${currentVersion} → ${latestVersion}\n`));

      if (options.check) {
        process.stdout.write(`Run ${green('collab upgrade')} to install the update.\n`);
        return;
      }

      // ── Perform the upgrade ──────────────────────────────────────
      const npmPath = requireNpm();
      if (!npmPath) {
        throw new CliError('npm not found in PATH. Install Node.js/npm first.');
      }

      process.stdout.write(`Upgrading collab-cli: ${currentVersion} → ${latestVersion}...\n`);

      if (!npmGlobalInstall(npmPath, latestVersion)) {
        throw new CliError('Upgrade failed.');
      }

      process.stdout.write(green(`${CHECK} Successfully upgraded to v${latestVersion}\n`));
      await checkForUpdate();
    });
}
