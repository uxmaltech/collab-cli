import { Command } from 'commander';

import { createCommandContext } from '../../lib/command-context';
import { checkEcosystemCompatibility } from '../../lib/ecosystem';
import { CliError } from '../../lib/errors';
import type { ServiceHealthOptions } from '../../lib/service-health';
import { resolveMcpComposeFile, runMcpCompose } from './shared';

interface McpCommandOptions {
  file?: string;
  outputDir?: string;
  timeoutMs?: string;
  retries?: string;
  retryDelayMs?: string;
}

function toPositiveInt(flagName: string, value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError(`${flagName} must be a positive integer.`);
  }

  return parsed;
}

function healthOptions(options: McpCommandOptions): ServiceHealthOptions {
  return {
    timeoutMs: toPositiveInt('--timeout-ms', options.timeoutMs, 5_000),
    retries: toPositiveInt('--retries', options.retries, 15),
    retryDelayMs: toPositiveInt('--retry-delay-ms', options.retryDelayMs, 2_000),
  };
}

export function registerMcpStartCommand(program: Command): void {
  program
    .command('start')
    .description('Start MCP runtime service and verify health endpoint')
    .option('--file <path>', 'Compose file to use')
    .option('--output-dir <directory>', 'Directory used to locate generated compose files')
    .option('--timeout-ms <ms>', 'Per-check timeout in milliseconds', '5000')
    .option('--retries <count>', 'Health check retries', '15')
    .option('--retry-delay-ms <ms>', 'Delay between retries in milliseconds', '2000')
    .addHelpText(
      'after',
      `
Examples:
  collab mcp start
  collab mcp start --file docker-compose.mcp.yml --timeout-ms 3000 --retries 20
`,
    )
    .action(async (options: McpCommandOptions, command: Command) => {
      const context = createCommandContext(command);
      const selection = resolveMcpComposeFile(context.config, options.outputDir, options.file);

      await runMcpCompose(
        context.logger,
        context.executor,
        context.config,
        selection,
        'up',
        {
          health: healthOptions(options),
        },
      );

      const compatibility = await checkEcosystemCompatibility(context.config, {
        dryRun: context.executor.dryRun,
      });
      for (const item of compatibility) {
        if (!item.ok) {
          context.logger.warn(`${item.id}: ${item.detail}${item.fix ? ` | fix: ${item.fix}` : ''}`);
        }
      }
      context.logger.result(`MCP service started using ${selection.filePath}`);
    });
}
