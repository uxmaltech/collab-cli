import { Command } from 'commander';

import { createCommandContext } from '../../lib/command-context';
import { runInfraCompose, resolveInfraComposeFile } from './shared';

interface InfraCommandOptions {
  file?: string;
  outputDir?: string;
}

export function registerInfraUpCommand(program: Command): void {
  program
    .command('up')
    .description('Start infrastructure services (Qdrant + Nebula)')
    .option('--file <path>', 'Compose file to use')
    .option('--output-dir <directory>', 'Directory used to locate generated compose files')
    .addHelpText(
      'after',
      `
Examples:
  collab infra up
  collab infra up --file docker-compose.infra.yml
`,
    )
    .action((options: InfraCommandOptions, command: Command) => {
      const context = createCommandContext(command);
      const selection = resolveInfraComposeFile(context.config, options.outputDir, options.file);

      runInfraCompose(context.logger, context.config.workspaceDir, selection, 'up');
      context.logger.result(`Infrastructure started using ${selection.filePath}`);
    });
}
