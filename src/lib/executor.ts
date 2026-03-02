import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { CliError, CommandExecutionError } from './errors';
import type { Logger } from './logger';
import { toShellCommand } from './shell';

export interface CommandRunOptions {
  cwd?: string;
  check?: boolean;
  verboseOnly?: boolean;
}

export interface CommandRunResult {
  status: number;
  stdout: string;
  stderr: string;
  command: string;
  simulated: boolean;
}

export interface WriteFileOptions {
  description?: string;
}

export interface ExecutorOptions {
  dryRun: boolean;
  cwd: string;
}

export class Executor {
  readonly dryRun: boolean;
  readonly cwd: string;

  private readonly logger: Logger;

  constructor(logger: Logger, options: ExecutorOptions) {
    this.logger = logger;
    this.dryRun = options.dryRun;
    this.cwd = options.cwd;
  }

  run(commandName: string, args: readonly string[], options: CommandRunOptions = {}): CommandRunResult {
    const commandLine = toShellCommand([commandName, ...args]);
    this.logger.command([commandName, ...args], { verboseOnly: options.verboseOnly });

    if (this.dryRun) {
      return {
        status: 0,
        stdout: '',
        stderr: '',
        command: commandLine,
        simulated: true,
      };
    }

    const result = spawnSync(commandName, args, {
      cwd: options.cwd ?? this.cwd,
      encoding: 'utf8',
    });

    if (result.error) {
      const errorCode = (result.error as NodeJS.ErrnoException).code;
      if (errorCode === 'ENOENT') {
        throw new CliError(`Command not found: ${commandName}`);
      }

      throw new CliError(result.error.message);
    }

    const outcome: CommandRunResult = {
      status: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      command: commandLine,
      simulated: false,
    };

    if (options.check ?? true) {
      if (outcome.status !== 0) {
        throw new CommandExecutionError(
          `Command failed: ${commandLine}`,
          {
            command: commandLine,
            exitCode: outcome.status,
            stderr: outcome.stderr,
            stdout: outcome.stdout,
          },
        );
      }
    }

    return outcome;
  }

  ensureDirectory(directoryPath: string): void {
    if (this.dryRun) {
      this.logger.info(`[dry-run] mkdir -p ${directoryPath}`);
      return;
    }

    fs.mkdirSync(directoryPath, { recursive: true });
  }

  writeFile(filePath: string, content: string, options: WriteFileOptions = {}): void {
    const description = options.description ?? 'write file';

    if (this.dryRun) {
      this.logger.info(`[dry-run] ${description}: ${filePath}`);
      return;
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
  }
}
