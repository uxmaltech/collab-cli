import { Command } from 'commander';

import { createCommandContext } from '../../lib/command-context';
import {
  resolveDevEnvConfig,
  resolveDevEnvStop,
  stopDevEnv,
  type DevEnvStopOptions,
} from './shared';

export function registerDevEnvStopCommand(program: Command): void {
  program
    .command('stop')
    .description('Stop the local development environment required by the current born agent')
    .option('--output-dir <directory>', 'Directory used to locate generated compose files')
    .option('--infra-file <path>', 'Infrastructure compose file to use')
    .option('--mcp-file <path>', 'MCP compose file to use')
    .addHelpText(
      'after',
      `
Examples:
  collab dev-env stop
  collab dev-env stop --infra-file infra/docker-compose.yml --mcp-file .collab/dev-env/docker-compose.mcp.generated.yml
`,
    )
    .action(async (options: DevEnvStopOptions, command: Command) => {
      const context = createCommandContext(command);
      const targetConfig = resolveDevEnvConfig(context.logger, context.config);
      const resolved = resolveDevEnvStop(context.logger, targetConfig, options);

      await stopDevEnv(context.logger, context.executor, targetConfig, resolved);

      context.logger.result('Development environment stopped');
      context.logger.summaryFooter([
        { label: 'workspace', value: targetConfig.workspaceDir },
        { label: 'infra compose', value: resolved.infraFile },
        { label: 'mcp compose', value: resolved.mcpFile },
        { label: 'state file', value: resolved.stateFile },
      ]);
    });
}
