import type { Command } from 'commander';

import { registerAstDeltaCommand } from './ast-delta';

export function registerCiCommand(program: Command): void {
  const ci = program
    .command('ci')
    .description('CI/CD pipeline utilities');

  registerAstDeltaCommand(ci);
}
