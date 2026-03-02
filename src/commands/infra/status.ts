import { Command } from 'commander';

import { createCommandContext } from '../../lib/command-context';
import { runInfraCompose, resolveInfraComposeFile } from './shared';

interface InfraCommandOptions {
  file?: string;
  outputDir?: string;
}

export function registerInfraStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show infrastructure service status')
    .option('--file <path>', 'Compose file to use')
    .option('--output-dir <directory>', 'Directory used to locate generated compose files')
    .addHelpText(
      'after',
      `
Examples:
  collab infra status
  collab infra status --file docker-compose.infra.yml
`,
    )
    .action((options: InfraCommandOptions, command: Command) => {
      const context = createCommandContext(command);
      const selection = resolveInfraComposeFile(context.config, options.outputDir, options.file);

      runInfraCompose(context.logger, context.config.workspaceDir, selection, 'ps');
      context.logger.result(`Infrastructure status checked via ${selection.filePath}`);
    });
}
