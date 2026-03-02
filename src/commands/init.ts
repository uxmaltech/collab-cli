import fs from 'node:fs';

import { Command } from 'commander';

import { createCommandContext } from '../lib/command-context';
import { ensureComposeEnvFile } from '../lib/compose-env';
import { defaultCollabConfig, ensureCollabDirectory, serializeUserConfig } from '../lib/config';
import { CliError } from '../lib/errors';
import { ensureWritableDirectory } from '../lib/preconditions';

interface InitOptions {
  force?: boolean;
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Create or refresh local collab-cli configuration files')
    .option('-f, --force', 'Overwrite existing .collab/config.json with defaults')
    .addHelpText(
      'after',
      `
Examples:
  collab init
  collab init --force
`,
    )
    .action((options: InitOptions, command: Command) => {
      const context = createCommandContext(command);
      ensureWritableDirectory(context.config.workspaceDir);
      ensureCollabDirectory(context.config);

      if (fs.existsSync(context.config.configFile) && !options.force) {
        throw new CliError(
          `${context.config.configFile} already exists. Run 'collab init --force' to overwrite it.`,
        );
      }

      const defaults = defaultCollabConfig(context.config.workspaceDir);
      fs.writeFileSync(defaults.configFile, `${serializeUserConfig(defaults)}\n`, 'utf8');
      ensureComposeEnvFile(defaults.envFile, context.logger);

      context.logger.result(`Initialized configuration at ${defaults.configFile}`);
      context.logger.result(`Environment defaults available at ${defaults.envFile}`);
    });
}
