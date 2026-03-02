import path from 'node:path';

import { Command } from 'commander';

import { createCommandContext } from '../lib/command-context';
import { runDockerCompose } from '../lib/docker-compose';
import { getComposeFilePaths, selectInfraComposeFile } from '../lib/compose-paths';
import { ensureCommandAvailable, ensureFileExists } from '../lib/preconditions';

interface SeedOptions {
  file?: string;
  outputDir?: string;
  dryRun?: boolean;
}

export function registerSeedCommand(program: Command): void {
  program
    .command('seed')
    .description('Run a baseline infrastructure readiness check before seeding data')
    .option('--file <path>', 'Compose file to use')
    .option('--output-dir <directory>', 'Directory used to locate generated compose files')
    .option('--dry-run', 'Print the seed preflight command without executing it')
    .addHelpText(
      'after',
      `
Examples:
  collab seed --dry-run
  collab seed --file docker-compose.infra.yml
`,
    )
    .action((options: SeedOptions, command: Command) => {
      const context = createCommandContext(command);
      const composePaths = getComposeFilePaths(context.config, options.outputDir);
      const selected = options.file
        ? { file: path.resolve(context.config.workspaceDir, options.file), source: 'split' as const }
        : selectInfraComposeFile(composePaths);
      const composeFile = options.file
        ? path.resolve(context.config.workspaceDir, options.file)
        : selected.file;

      ensureFileExists(composeFile, 'Compose file');

      if (options.dryRun) {
        context.logger.command(['docker', 'compose', '-f', composeFile, 'ps']);
        context.logger.result('Seed preflight command rendered (dry-run).');
        return;
      }

      ensureCommandAvailable('docker');
      runDockerCompose({
        files: [composeFile],
        arguments: ['ps'],
        cwd: context.config.workspaceDir,
        logger: context.logger,
      });

      context.logger.result(
        'Seed preflight passed. Infrastructure is reachable; run domain seeding workflow next.',
      );
    });
}
