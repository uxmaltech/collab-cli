import { bold, cyan, dim, green, red, yellow, CHECK, CROSS } from './ansi';
import { toShellCommand } from './shell';

export type Verbosity = 'quiet' | 'normal' | 'verbose';

export interface CommandLogOptions {
  verboseOnly?: boolean;
}

export interface SummaryEntry {
  label: string;
  value: string;
}

export interface Logger {
  readonly verbosity: Verbosity;
  info(message: string): void;
  debug(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  result(message: string): void;
  command(parts: readonly string[], options?: CommandLogOptions): void;
  stageHeader(index: number, total: number, title: string): void;
  step(ok: boolean, message: string): void;
  workflowHeader(workflow: string, mode: string): void;
  summaryFooter(entries: readonly SummaryEntry[]): void;
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

    process.stdout.write(`        ${message}\n`);
  }

  debug(message: string): void {
    if (this.verbosity !== 'verbose') {
      return;
    }

    process.stdout.write(`        ${dim(message)}\n`);
  }

  warn(message: string): void {
    process.stderr.write(`        ${yellow('Warning:')} ${message}\n`);
  }

  error(message: string): void {
    process.stderr.write(`        ${red('Error:')} ${message}\n`);
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

    process.stdout.write(`        ${dim('$')} ${dim(toShellCommand(parts))}\n`);
  }

  stageHeader(index: number, total: number, title: string): void {
    if (this.verbosity === 'quiet') {
      return;
    }

    const tag = bold(cyan(`[${index}/${total}]`));
    process.stdout.write(`\n  ${tag} ${bold(title)}\n`);
  }

  step(ok: boolean, message: string): void {
    if (this.verbosity === 'quiet') {
      return;
    }

    const marker = ok ? green(CHECK) : red(CROSS);
    process.stdout.write(`        ${marker} ${message}\n`);
  }

  workflowHeader(workflow: string, mode: string): void {
    process.stdout.write(`\n  ${bold(workflow)} ${dim(`\u2014 ${mode}`)}\n`);
  }

  summaryFooter(entries: readonly SummaryEntry[]): void {
    process.stdout.write(`\n  ${dim('\u2500'.repeat(40))}\n`);
    process.stdout.write(`  ${bold(green(CHECK))} ${bold('Init complete')}\n\n`);

    for (const entry of entries) {
      process.stdout.write(`  ${dim(entry.label + ':')} ${entry.value}\n`);
    }

    process.stdout.write('\n');
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
