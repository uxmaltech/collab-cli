import type { Command } from 'commander';

import { loadCollabConfig, type CollabConfig } from './config';
import { Executor } from './executor';
import { createLogger, type Logger } from './logger';

/**
 * Global CLI options inherited by every subcommand via Commander's
 * `optsWithGlobals()`. These are defined on the root `program` object.
 */
export interface GlobalCliOptions {
  verbose?: boolean;
  quiet?: boolean;
  cwd?: string;
  dryRun?: boolean;
}

/**
 * Shared context available to every command action.
 * Created once per invocation by {@link createCommandContext}.
 */
export interface CommandContext {
  /** Resolved working directory. */
  cwd: string;
  /** Logger configured with the requested verbosity. */
  logger: Logger;
  /** Workspace configuration loaded from `.collab/config.json`. */
  config: CollabConfig;
  /** Side-effect executor that respects `--dry-run`. */
  executor: Executor;
  /** Convenience shorthand for `executor.dryRun`. */
  dryRun: boolean;
}

/**
 * Builds a {@link CommandContext} from a Commander action's `command` ref.
 * Reads global options, resolves the workspace, and wires up logging.
 */
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
