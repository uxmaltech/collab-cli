import { Command } from 'commander';

import { createCommandContext } from '../../lib/command-context';
import { parseHealthOptions } from '../../lib/parsers';
import { prepareDevEnv, startDevEnv, type DevEnvStartOptions } from './shared';

export function registerDevEnvStartCommand(program: Command): void {
  program
    .command('start')
    .description('Build and start the local development environment required by the current born agent')
    .option('--output-dir <directory>', 'Directory used to locate generated compose files')
    .option('--infra-file <path>', 'Infrastructure compose file to use')
    .option('--mcp-file <path>', 'MCP compose file to use')
    .option(
      '--source-architecture-mcp <path>',
      'Local checkout of collab-architecture-mcp to build instead of pulling ghcr',
    )
    .option('--timeout-ms <ms>', 'Per-check timeout in milliseconds', '5000')
    .option('--retries <count>', 'Health check retries', '15')
    .option('--retry-delay-ms <ms>', 'Delay between retries in milliseconds', '2000')
    .addHelpText(
      'after',
      `
Examples:
  collab dev-env start
  collab dev-env start --source-architecture-mcp ../collab-architecture-mcp
`,
    )
    .action(async (options: DevEnvStartOptions, command: Command) => {
      const context = createCommandContext(command);
      const prepared = prepareDevEnv(
        context.logger,
        context.executor,
        context.config,
        options,
      );

      await startDevEnv(
        context.logger,
        context.executor,
        context.config,
        prepared,
        parseHealthOptions(options),
      );

      context.logger.result('Development environment started');
      context.logger.summaryFooter([
        { label: 'workspace', value: context.config.workspaceDir },
        { label: 'infra compose', value: prepared.infraFile },
        { label: 'mcp compose', value: prepared.mcpFile },
        { label: 'mcp source compose', value: prepared.sourceMcpFile },
        { label: 'mcp dockerfile', value: prepared.dockerfile },
        { label: 'mcp image', value: prepared.architectureMcpImage },
        { label: 'mcp source', value: prepared.architectureMcpSource },
      ]);
    });
}
