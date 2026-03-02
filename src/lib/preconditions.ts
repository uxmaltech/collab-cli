import fs from 'node:fs';

import { CliError } from './errors';
import { resolveCommandPath } from './shell';

export function ensureCommandAvailable(commandName: string): string {
  const resolved = resolveCommandPath(commandName);
  if (!resolved) {
    throw new CliError(
      `Required command '${commandName}' is not available in PATH. Install it and retry.`,
    );
  }

  return resolved;
}

export function ensureFileExists(filePath: string, label = 'File'): void {
  if (!fs.existsSync(filePath)) {
    throw new CliError(`${label} not found: ${filePath}`);
  }
}

export function ensureWritableDirectory(directoryPath: string): void {
  fs.mkdirSync(directoryPath, { recursive: true });
  try {
    fs.accessSync(directoryPath, fs.constants.W_OK);
  } catch {
    throw new CliError(`Directory is not writable: ${directoryPath}`);
  }
}
