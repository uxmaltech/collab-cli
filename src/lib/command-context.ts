import type { Command } from 'commander';

import { loadCollabConfig, type CollabConfig } from './config';
import { createLogger, type Logger } from './logger';

export interface GlobalCliOptions {
  verbose?: boolean;
  quiet?: boolean;
  cwd?: string;
}

export interface CommandContext {
  cwd: string;
  logger: Logger;
  config: CollabConfig;
}

export function createCommandContext(command: Command): CommandContext {
  const options = command.optsWithGlobals<GlobalCliOptions>();
  const cwd = options.cwd ? options.cwd : process.cwd();

  return {
    cwd,
    logger: createLogger({ verbose: options.verbose, quiet: options.quiet }),
    config: loadCollabConfig(cwd),
  };
}
