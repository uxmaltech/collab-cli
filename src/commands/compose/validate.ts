import fs from 'node:fs';
import path from 'node:path';

import { Command } from 'commander';

import { createCommandContext } from '../../lib/command-context';
import { assertComposeFilesValid } from '../../lib/compose-validator';
import type { CollabConfig } from '../../lib/config';
import { getComposeFilePaths, type ComposeMode } from '../../lib/compose-paths';
import { CliError } from '../../lib/errors';

interface ComposeValidateOptions {
  mode?: string;
  file?: string[];
  outputDir?: string;
}

function parseValidateMode(value: string | undefined): ComposeMode | 'auto' {
  if (!value || value === 'auto' || value === 'consolidated' || value === 'split') {
    return (value ?? 'auto') as ComposeMode | 'auto';
  }

  throw new CliError(`Invalid mode '${value}'. Use 'auto', 'consolidated', or 'split'.`);
}

function resolveFiles(
  options: ComposeValidateOptions,
  config: CollabConfig,
  mode: ComposeMode | 'auto',
): string[] {
  if (options.file && options.file.length > 0) {
    return options.file.map((item) => path.resolve(config.workspaceDir, item));
  }

  const paths = getComposeFilePaths(config, options.outputDir);

  if (mode === 'consolidated') {
    return [paths.consolidated];
  }

  if (mode === 'split') {
    return [paths.infra, paths.mcp];
  }

  const splitExists = [paths.infra, paths.mcp].every((candidate) => fs.existsSync(candidate));

  return splitExists ? [paths.infra, paths.mcp] : [paths.consolidated];
}

export function registerComposeValidateCommand(program: Command): void {
  program
    .command('validate')
    .description('Validate generated Docker Compose files via docker compose config')
    .option('--mode <mode>', 'Validation mode: auto|consolidated|split', 'auto')
    .option('--file <path...>', 'Explicit compose files to validate')
    .option('--output-dir <directory>', 'Compose directory when using mode selection')
    .addHelpText(
      'after',
      `
Examples:
  collab compose validate --mode auto
  collab compose validate --mode split
  collab compose validate --file docker-compose.yml
`,
    )
    .action((options: ComposeValidateOptions, command: Command) => {
      const context = createCommandContext(command);
      const mode = parseValidateMode(options.mode);
      const files = resolveFiles(options, context.config, mode);

      assertComposeFilesValid(files, context.config.workspaceDir, context.logger);
      context.logger.result(`Compose validation successful for ${files.length} file(s).`);
    });
}
