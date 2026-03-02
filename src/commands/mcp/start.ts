import { Command } from 'commander';

import { createCommandContext } from '../../lib/command-context';
import { resolveMcpComposeFile, runMcpCompose } from './shared';

interface McpCommandOptions {
  file?: string;
  outputDir?: string;
}

export function registerMcpStartCommand(program: Command): void {
  program
    .command('start')
    .description('Start MCP runtime service')
    .option('--file <path>', 'Compose file to use')
    .option('--output-dir <directory>', 'Directory used to locate generated compose files')
    .addHelpText(
      'after',
      `
Examples:
  collab mcp start
  collab mcp start --file docker-compose.mcp.yml
`,
    )
    .action((options: McpCommandOptions, command: Command) => {
      const context = createCommandContext(command);
      const selection = resolveMcpComposeFile(context.config, options.outputDir, options.file);

      runMcpCompose(context.logger, context.config.workspaceDir, selection, 'up');
      context.logger.result(`MCP service started using ${selection.filePath}`);
    });
}
