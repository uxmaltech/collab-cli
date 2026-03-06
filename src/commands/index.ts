import type { Command } from 'commander';

import { registerCanonCommand } from './canon';
import { registerComposeCommand } from './compose';
import { registerDoctorCommand } from './doctor';
import { registerEndCommand } from './end';
import { registerInfraCommand } from './infra';
import { registerInitCommand } from './init';
import { registerMcpCommand } from './mcp';
import { registerSeedCommand } from './seed';
import { registerUpCommand } from './up';
import { registerUninstallCommand } from './uninstall';
import { registerUpdateCanonsCommand } from './update-canons';
import { registerUpgradeCommand } from './upgrade';

export function registerCommands(program: Command): void {
  registerInitCommand(program);
  registerEndCommand(program);
  registerCanonCommand(program);
  registerComposeCommand(program);
  registerInfraCommand(program);
  registerMcpCommand(program);
  registerUpCommand(program);
  registerSeedCommand(program);
  registerDoctorCommand(program);
  registerUpdateCanonsCommand(program);
  registerUpgradeCommand(program);
  registerUninstallCommand(program);
}
