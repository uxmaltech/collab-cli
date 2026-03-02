import fs from 'node:fs';
import path from 'node:path';

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

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

export function shellQuote(argument: string): string {
  if (/^[a-zA-Z0-9_./:@%+=,-]+$/.test(argument)) {
    return argument;
  }

  return `'${argument.replace(/'/g, `'"'"'`)}'`;
}

export function toShellCommand(parts: readonly string[]): string {
  return parts.map((part) => shellQuote(part)).join(' ');
}
