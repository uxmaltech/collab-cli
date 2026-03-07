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
  repoHeader(repoName: string, index: number, total: number): void;
  phaseHeader(title: string, subtitle?: string): void;
  wizardStep(current: number, title: string, subtitle?: string): void;
  wizardIntro(title: string): void;
  wizardOutro(message: string): void;
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

  repoHeader(repoName: string, index: number, total: number): void {
    if (this.verbosity === 'quiet') return;
    const tag = bold(cyan(`[repo ${index}/${total}]`));
    process.stdout.write(`\n  ${tag} ${bold(repoName)}\n`);
  }

  phaseHeader(title: string, subtitle?: string): void {
    if (this.verbosity === 'quiet') return;

    const line = dim('\u2500'.repeat(48));
    const sub = subtitle ? `  ${dim(subtitle)}` : '';
    process.stdout.write(`\n  ${line}\n  ${bold(cyan(title))}${sub}\n  ${line}\n\n`);
  }

  wizardStep(current: number, title: string, subtitle?: string): void {
    if (this.verbosity === 'quiet') return;

    const bar = dim('\u2502');
    const dot = bold(cyan('\u25c6'));
    const counter = dim(`Step ${current}`);
    const sub = subtitle ? ` ${dim('\u00b7')} ${dim(subtitle)}` : '';

    process.stdout.write(`\n  ${bar}\n  ${dot}  ${counter} ${dim('\u00b7')} ${bold(title)}${sub}\n  ${bar}\n`);
  }

  wizardIntro(title: string): void {
    if (this.verbosity === 'quiet') return;

    const top = bold(cyan('\u250c'));
    process.stdout.write(`\n  ${top}  ${bold(title)}\n`);
  }

  wizardOutro(message: string): void {
    if (this.verbosity === 'quiet') return;

    const bottom = bold(green('\u2514'));
    process.stdout.write(`\n  ${bottom}  ${bold(green(message))}\n\n`);
  }

  summaryFooter(entries: readonly SummaryEntry[]): void {
    if (this.verbosity === 'quiet') return;

    const bar = dim('\u2502');
    process.stdout.write(`\n  ${bar}\n`);

    for (const entry of entries) {
      process.stdout.write(`  ${bar}  ${dim(entry.label + ':')} ${entry.value}\n`);
    }

    process.stdout.write(`  ${bar}\n`);
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
