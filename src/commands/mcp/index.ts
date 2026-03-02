import type { Command } from 'commander';

import { registerMcpStartCommand } from './start';
import { registerMcpStatusCommand } from './status';
import { registerMcpStopCommand } from './stop';

export function registerMcpCommand(program: Command): void {
  const mcp = program
    .command('mcp')
    .description('Manage MCP runtime lifecycle')
    .addHelpText(
      'after',
      `
Examples:
  collab mcp start
  collab mcp stop
  collab mcp status
`,
    );

  registerMcpStartCommand(mcp);
  registerMcpStopCommand(mcp);
  registerMcpStatusCommand(mcp);
}
