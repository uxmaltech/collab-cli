/**
 * Base error class for all expected CLI failures.
 * The top-level entrypoint catches these and exits with `exitCode`
 * instead of printing an unhandled exception stack trace.
 */
export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

/** Structured details attached to a {@link CommandExecutionError}. */
export interface CommandExecutionErrorDetails {
  command: string;
  exitCode: number;
  stderr: string;
  stdout: string;
}

/**
 * Thrown when a subprocess exits with a non-zero status.
 * Carries the full stdout/stderr for diagnostics.
 */
export class CommandExecutionError extends CliError {
  readonly details: CommandExecutionErrorDetails;

  constructor(message: string, details: CommandExecutionErrorDetails) {
    super(message, details.exitCode ?? 1);
    this.name = 'CommandExecutionError';
    this.details = details;
  }
}
