import { Command } from 'commander';

import { createCommandContext } from '../../lib/command-context';
import { runInfraCompose, resolveInfraComposeFile } from './shared';

interface InfraCommandOptions {
  file?: string;
  outputDir?: string;
}

export function registerInfraDownCommand(program: Command): void {
  program
    .command('down')
    .description('Stop infrastructure services (Qdrant + Nebula)')
    .option('--file <path>', 'Compose file to use')
    .option('--output-dir <directory>', 'Directory used to locate generated compose files')
    .addHelpText(
      'after',
      `
Examples:
  collab infra down
  collab infra down --file docker-compose.yml
`,
    )
    .action((options: InfraCommandOptions, command: Command) => {
      const context = createCommandContext(command);
      const selection = resolveInfraComposeFile(context.config, options.outputDir, options.file);

      runInfraCompose(context.logger, context.config.workspaceDir, selection, 'stop');
      context.logger.result(`Infrastructure stopped using ${selection.filePath}`);
    });
}
