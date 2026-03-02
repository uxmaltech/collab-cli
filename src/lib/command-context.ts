import type { Command } from 'commander';

import { loadCollabConfig, type CollabConfig } from './config';
import { Executor } from './executor';
import { createLogger, type Logger } from './logger';

export interface GlobalCliOptions {
  verbose?: boolean;
  quiet?: boolean;
  cwd?: string;
  dryRun?: boolean;
}

export interface CommandContext {
  cwd: string;
  logger: Logger;
  config: CollabConfig;
  executor: Executor;
  dryRun: boolean;
}

export function createCommandContext(command: Command): CommandContext {
  const options = command.optsWithGlobals<GlobalCliOptions>();
  const cwd = options.cwd ? options.cwd : process.cwd();
  const logger = createLogger({ verbose: options.verbose, quiet: options.quiet });
  const dryRun = Boolean(options.dryRun);

  return {
    cwd,
    logger,
    config: loadCollabConfig(cwd),
    executor: new Executor(logger, { dryRun, cwd }),
    dryRun,
  };
}
