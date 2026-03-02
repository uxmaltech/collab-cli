export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

export interface CommandExecutionErrorDetails {
  command: string;
  exitCode: number;
  stderr: string;
  stdout: string;
}

export class CommandExecutionError extends CliError {
  readonly details: CommandExecutionErrorDetails;

  constructor(message: string, details: CommandExecutionErrorDetails) {
    super(message, details.exitCode ?? 1);
    this.name = 'CommandExecutionError';
    this.details = details;
  }
}
