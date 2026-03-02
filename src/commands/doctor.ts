import { Command } from 'commander';

import { createCommandContext } from '../lib/command-context';
import { resolveCommandPath } from '../lib/shell';

const DIAGNOSTIC_COMMANDS = ['node', 'npm', 'git', 'docker'] as const;

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Run environment diagnostics and show tool availability')
    .addHelpText(
      'after',
      `
Examples:
  collab doctor
  collab doctor --verbose
`,
    )
    .action((_options: unknown, command: Command) => {
      const context = createCommandContext(command);

      context.logger.result(`node: ${process.version}`);
      context.logger.result(`platform: ${process.platform}/${process.arch}`);
      context.logger.result(`workspace: ${context.config.workspaceDir}`);

      for (const tool of DIAGNOSTIC_COMMANDS) {
        const resolved = resolveCommandPath(tool);
        if (resolved) {
          context.logger.result(`${tool}: ${resolved}`);
        } else {
          context.logger.warn(`${tool} not found in PATH`);
        }
      }
    });
}
