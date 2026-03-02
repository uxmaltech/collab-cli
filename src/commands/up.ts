import { Command } from 'commander';

import { createCommandContext } from '../lib/command-context';
import { checkEcosystemCompatibility } from '../lib/ecosystem';
import { parseMode } from '../lib/mode';
import { runOrchestration } from '../lib/orchestrator';
import type { ServiceHealthOptions } from '../lib/service-health';
import { resolveInfraComposeFile, runInfraCompose } from './infra/shared';
import { resolveMcpComposeFile, runMcpCompose } from './mcp/shared';

interface UpOptions {
  mode?: string;
  file?: string;
  outputDir?: string;
  timeoutMs?: string;
  retries?: string;
  retryDelayMs?: string;
  resume?: boolean;
}

function toNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function healthOptions(options: UpOptions): ServiceHealthOptions {
  return {
    timeoutMs: toNumber(options.timeoutMs, 5_000),
    retries: toNumber(options.retries, 15),
    retryDelayMs: toNumber(options.retryDelayMs, 2_000),
  };
}

export function registerUpCommand(program: Command): void {
  program
    .command('up')
    .description('Run full startup pipeline (infra -> MCP)')
    .option('--mode <mode>', 'Execution mode: file-only|indexed')
    .option('--file <path>', 'Compose file used for infra and mcp commands')
    .option('--output-dir <directory>', 'Directory used to locate generated compose files')
    .option('--timeout-ms <ms>', 'Per-check timeout in milliseconds', '5000')
    .option('--retries <count>', 'Health check retries', '15')
    .option('--retry-delay-ms <ms>', 'Delay between retries in milliseconds', '2000')
    .option('--resume', 'Resume from last incomplete stage for this workflow')
    .addHelpText(
      'after',
      `
Examples:
  collab up
  collab up --mode indexed --timeout-ms 3000 --retries 20
  collab up --resume
`,
    )
    .action(async (options: UpOptions, command: Command) => {
      const context = createCommandContext(command);
      const mode = parseMode(options.mode, context.config.mode);

      if (mode === 'file-only') {
        context.logger.result('Mode file-only: skipping infra and MCP startup pipeline.');
        return;
      }

      const health = healthOptions(options);

      await runOrchestration(
        {
          workflowId: 'up',
          config: context.config,
          executor: context.executor,
          logger: context.logger,
          resume: options.resume,
        },
        [
          {
            id: 'infra-up',
            title: 'Start infrastructure services',
            recovery: [
              'Run collab infra status to inspect service state.',
              'Run collab up --resume after fixing infra issues.',
            ],
            run: async () => {
              const selection = resolveInfraComposeFile(context.config, options.outputDir, options.file);
              await runInfraCompose(
                context.logger,
                context.executor,
                context.config,
                selection,
                'up',
                { health },
              );
            },
          },
          {
            id: 'mcp-up',
            title: 'Start MCP service',
            recovery: [
              'Run collab mcp status to inspect service state.',
              'Run collab up --resume after fixing MCP issues.',
            ],
            run: async () => {
              const selection = resolveMcpComposeFile(context.config, options.outputDir, options.file);
              await runMcpCompose(
                context.logger,
                context.executor,
                context.config,
                selection,
                'up',
                { health },
              );
            },
          },
        ],
      );

      const compatibility = await checkEcosystemCompatibility(context.config, {
        dryRun: context.executor.dryRun,
      });
      for (const item of compatibility) {
        if (!item.ok) {
          context.logger.warn(`${item.id}: ${item.detail}${item.fix ? ` | fix: ${item.fix}` : ''}`);
        }
      }

      context.logger.result('Full startup pipeline completed successfully.');
    });
}
