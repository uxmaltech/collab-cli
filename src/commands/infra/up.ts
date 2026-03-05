import { Command } from 'commander';

import { createCommandContext } from '../../lib/command-context';
import { parseHealthOptions } from '../../lib/parsers';
import { runInfraCompose, resolveInfraComposeFile } from './shared';

interface InfraCommandOptions {
  file?: string;
  outputDir?: string;
  timeoutMs?: string;
  retries?: string;
  retryDelayMs?: string;
}

export function registerInfraUpCommand(program: Command): void {
  program
    .command('up')
    .description('Start infrastructure services (Qdrant + Nebula) and wait for health')
    .option('--file <path>', 'Compose file to use')
    .option('--output-dir <directory>', 'Directory used to locate generated compose files')
    .option('--timeout-ms <ms>', 'Per-check timeout in milliseconds', '5000')
    .option('--retries <count>', 'Health check retries', '15')
    .option('--retry-delay-ms <ms>', 'Delay between retries in milliseconds', '2000')
    .addHelpText(
      'after',
      `
Examples:
  collab infra up
  collab infra up --file docker-compose.infra.yml --timeout-ms 3000 --retries 20
`,
    )
    .action(async (options: InfraCommandOptions, command: Command) => {
      const context = createCommandContext(command);
      const selection = resolveInfraComposeFile(context.config, options.outputDir, options.file);

      await runInfraCompose(
        context.logger,
        context.executor,
        context.config,
        selection,
        'up',
        {
          health: parseHealthOptions(options),
        },
      );
      context.logger.result(`Infrastructure started using ${selection.filePath}`);
    });
}
