import fs from 'node:fs';
import path from 'node:path';

/** Checks whether the file at `filePath` has the execute permission. */
function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Searches `$PATH` for an executable named `commandName`.
 * Returns the full path on success, or `null` when not found.
 */
export function resolveCommandPath(commandName: string): string | null {
  const pathEnv = process.env.PATH ?? '';
  const directories = pathEnv.split(path.delimiter).filter(Boolean);

  for (const directory of directories) {
    const fullPath = path.join(directory, commandName);
    if (fs.existsSync(fullPath) && isExecutable(fullPath)) {
      return fullPath;
    }
  }

  return null;
}

/**
 * Wraps `argument` in single-quotes if it contains shell-special characters.
 * Safe arguments (alphanumeric + common punctuation) are returned as-is.
 */
export function shellQuote(argument: string): string {
  if (/^[a-zA-Z0-9_./:@%+=,-]+$/.test(argument)) {
    return argument;
  }

  return `'${argument.replace(/'/g, `'"'"'`)}'`;
}

/** Joins an argument list into a shell-safe command string. */
export function toShellCommand(parts: readonly string[]): string {
  return parts.map((part) => shellQuote(part)).join(' ');
}
