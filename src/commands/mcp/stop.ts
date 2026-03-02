import { Command } from 'commander';

import { createCommandContext } from '../../lib/command-context';
import { resolveMcpComposeFile, runMcpCompose } from './shared';

interface McpCommandOptions {
  file?: string;
  outputDir?: string;
}

export function registerMcpStopCommand(program: Command): void {
  program
    .command('stop')
    .description('Stop MCP runtime service')
    .option('--file <path>', 'Compose file to use')
    .option('--output-dir <directory>', 'Directory used to locate generated compose files')
    .addHelpText(
      'after',
      `
Examples:
  collab mcp stop
  collab mcp stop --file docker-compose.yml
`,
    )
    .action((options: McpCommandOptions, command: Command) => {
      const context = createCommandContext(command);
      const selection = resolveMcpComposeFile(context.config, options.outputDir, options.file);

      runMcpCompose(context.logger, context.config.workspaceDir, selection, 'stop');
      context.logger.result(`MCP service stopped using ${selection.filePath}`);
    });
}
