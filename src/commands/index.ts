import type { Command } from 'commander';

import { registerComposeCommand } from './compose';
import { registerDoctorCommand } from './doctor';
import { registerInfraCommand } from './infra';
import { registerInitCommand } from './init';
import { registerMcpCommand } from './mcp';
import { registerSeedCommand } from './seed';

export function registerCommands(program: Command): void {
  registerInitCommand(program);
  registerComposeCommand(program);
  registerInfraCommand(program);
  registerMcpCommand(program);
  registerSeedCommand(program);
  registerDoctorCommand(program);
}
