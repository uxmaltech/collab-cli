import { toShellCommand } from './shell';

export type Verbosity = 'quiet' | 'normal' | 'verbose';

export interface CommandLogOptions {
  verboseOnly?: boolean;
}

export interface Logger {
  readonly verbosity: Verbosity;
  info(message: string): void;
  debug(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  result(message: string): void;
  command(parts: readonly string[], options?: CommandLogOptions): void;
}

class ConsoleLogger implements Logger {
  readonly verbosity: Verbosity;

  constructor(verbosity: Verbosity) {
    this.verbosity = verbosity;
  }

  info(message: string): void {
    if (this.verbosity === 'quiet') {
      return;
    }

    process.stdout.write(`${message}\n`);
  }

  debug(message: string): void {
    if (this.verbosity !== 'verbose') {
      return;
    }

    process.stdout.write(`${message}\n`);
  }

  warn(message: string): void {
    process.stderr.write(`Warning: ${message}\n`);
  }

  error(message: string): void {
    process.stderr.write(`Error: ${message}\n`);
  }

  result(message: string): void {
    process.stdout.write(`${message}\n`);
  }

  command(parts: readonly string[], options?: CommandLogOptions): void {
    if (this.verbosity === 'quiet') {
      return;
    }

    if (options?.verboseOnly && this.verbosity !== 'verbose') {
      return;
    }

    process.stdout.write(`$ ${toShellCommand(parts)}\n`);
  }
}

export interface LoggerOptions {
  verbose?: boolean;
  quiet?: boolean;
}

export function createLogger(options: LoggerOptions): Logger {
  const verbosity: Verbosity = options.quiet ? 'quiet' : options.verbose ? 'verbose' : 'normal';
  return new ConsoleLogger(verbosity);
}
