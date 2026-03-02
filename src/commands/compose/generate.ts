import path from 'node:path';

import { Command } from 'commander';

import { createCommandContext } from '../../lib/command-context';
import { assertComposeFilesValid } from '../../lib/compose-validator';
import { generateComposeFiles } from '../../lib/compose-renderer';
import type { ComposeMode } from '../../lib/compose-paths';
import { CliError } from '../../lib/errors';
import { ensureWritableDirectory } from '../../lib/preconditions';

interface ComposeGenerateOptions {
  mode?: string;
  output?: string;
  outputDir?: string;
  envFile?: string;
  skipValidate?: boolean;
}

function parseMode(value: string | undefined): ComposeMode {
  if (!value || value === 'consolidated' || value === 'split') {
    return (value ?? 'consolidated') as ComposeMode;
  }

  throw new CliError(`Invalid mode '${value}'. Use 'consolidated' or 'split'.`);
}

export function registerComposeGenerateCommand(program: Command): void {
  program
    .command('generate')
    .description('Generate Docker Compose templates for collab services')
    .option('--mode <mode>', 'Generation mode: consolidated|split', 'consolidated')
    .option('--output <file>', 'Output path for consolidated mode')
    .option('--output-dir <directory>', 'Output directory for generated compose files')
    .option('--env-file <file>', 'Path to environment override file')
    .option('--skip-validate', 'Skip docker compose validation after generation')
    .addHelpText(
      'after',
      `
Examples:
  collab compose generate --mode consolidated
  collab compose generate --mode consolidated --output docker-compose.local.yml
  collab compose generate --mode split --output-dir ./deploy
`,
    )
    .action((options: ComposeGenerateOptions, command: Command) => {
      const context = createCommandContext(command);
      const mode = parseMode(options.mode);

      if (options.output && mode !== 'consolidated') {
        throw new CliError('--output can only be used with --mode consolidated.');
      }

      if (options.outputDir) {
        ensureWritableDirectory(path.resolve(context.config.workspaceDir, options.outputDir));
      }

      const generation = generateComposeFiles({
        config: context.config,
        logger: context.logger,
        mode,
        outputDirectory: options.outputDir,
        outputFile: options.output,
        envFile: options.envFile,
      });

      for (const warning of generation.driftWarnings) {
        context.logger.warn(warning);
      }

      for (const file of generation.files) {
        context.logger.info(`Generated ${file.filePath}`);
      }

      context.logger.info(`Using environment file ${generation.envFilePath}`);

      if (!options.skipValidate) {
        assertComposeFilesValid(
          generation.files.map((file) => file.filePath),
          context.config.workspaceDir,
          context.logger,
        );
      }

      context.logger.result('Compose generation completed successfully.');
    });
}
