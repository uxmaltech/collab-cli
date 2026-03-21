import type { Command } from 'commander';

import { registerAgentBootstrapCommand } from './bootstrap';
import { registerAgentStartCommand } from './start';

export function registerAgentCommand(program: Command): void {
  const agent = program
    .command('agent')
    .description('Manage Collab runtime agent workspaces')
    .addHelpText(
      'after',
      `
Examples:
  collab agent bootstrap --agent-name "Collab Architect"
  collab agent birth --agent-name "Collab Architect"
  collab agent start
  collab agent start agent.collab-architect
`,
    );

  registerAgentBootstrapCommand(agent);
  registerAgentStartCommand(agent);
}
