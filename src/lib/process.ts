import { spawnSync } from 'node:child_process';

import { CliError } from './errors';
import type { Logger } from './logger';

export interface RunProcessOptions {
  cwd?: string;
  check?: boolean;
  verboseOnly?: boolean;
}

export interface RunProcessResult {
  status: number;
  stdout: string;
  stderr: string;
}

export function runProcess(
  commandName: string,
  args: readonly string[],
  logger: Logger,
  options: RunProcessOptions = {},
): RunProcessResult {
  logger.command([commandName, ...args], { verboseOnly: options.verboseOnly });

  const run = spawnSync(commandName, args, {
    cwd: options.cwd,
    encoding: 'utf8',
  });

  if (run.error) {
    const errorCode = (run.error as NodeJS.ErrnoException).code;
    if (errorCode === 'ENOENT') {
      throw new CliError(`Command not found: ${commandName}`);
    }

    throw new CliError(run.error.message);
  }

  const result: RunProcessResult = {
    status: run.status ?? 1,
    stdout: run.stdout ?? '',
    stderr: run.stderr ?? '',
  };

  if (options.check ?? true) {
    if (result.status !== 0) {
      throw new CliError(result.stderr || result.stdout || `Command failed: ${commandName}`);
    }
  }

  return result;
}
