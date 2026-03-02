import type { Executor } from './executor';
import { CliError } from './errors';
import { runDockerCompose } from './docker-compose';
import { ensureCommandAvailable, ensureFileExists } from './preconditions';

export interface ComposeValidationError {
  filePath: string;
  message: string;
}

function compactError(raw: string): string {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  return lines.slice(0, 12).join('\n');
}

export function validateComposeFiles(
  filePaths: readonly string[],
  cwd: string,
  executor: Executor,
): ComposeValidationError[] {
  if (executor.dryRun) {
    for (const filePath of filePaths) {
      executor.run('docker', ['compose', '-f', filePath, 'config'], {
        cwd,
        check: false,
      });
    }

    return [];
  }

  for (const filePath of filePaths) {
    ensureFileExists(filePath, 'Compose file');
  }

  ensureCommandAvailable('docker', { dryRun: executor.dryRun });

  const errors: ComposeValidationError[] = [];

  for (const filePath of filePaths) {
    const result = runDockerCompose({
      executor,
      files: [filePath],
      arguments: ['config'],
      cwd,
      check: false,
    });

    if (result.status !== 0) {
      errors.push({
        filePath,
        message: compactError(result.stderr || result.stdout),
      });
    }
  }

  return errors;
}

export function assertComposeFilesValid(
  filePaths: readonly string[],
  cwd: string,
  executor: Executor,
): void {
  const errors = validateComposeFiles(filePaths, cwd, executor);

  if (errors.length === 0) {
    return;
  }

  const formatted = errors
    .map((item) => `- ${item.filePath}\n${item.message || '(no error details available)'}`)
    .join('\n\n');

  throw new CliError(`Compose validation failed:\n${formatted}`);
}
