import { Command } from 'commander';

import { createCommandContext } from '../../lib/command-context';
import { resolveMcpComposeFile, runMcpCompose } from './shared';

interface McpCommandOptions {
  file?: string;
  outputDir?: string;
}

export function registerMcpStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show MCP runtime service status')
    .option('--file <path>', 'Compose file to use')
    .option('--output-dir <directory>', 'Directory used to locate generated compose files')
    .addHelpText(
      'after',
      `
Examples:
  collab mcp status
  collab mcp status --file docker-compose.mcp.yml
`,
    )
    .action(async (options: McpCommandOptions, command: Command) => {
      const context = createCommandContext(command);
      const selection = resolveMcpComposeFile(context.config, options.outputDir, options.file);

      await runMcpCompose(context.logger, context.executor, context.config, selection, 'ps');
      context.logger.result(`MCP status checked via ${selection.filePath}`);
    });
}
