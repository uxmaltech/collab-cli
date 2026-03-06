import { execFileSync } from 'node:child_process';

import { red, CROSS } from './ansi';
import { resolveCommandPath } from './shell';

const NPM_PACKAGE = '@uxmaltech/collab-cli';
const PERMISSION_ERROR = /EACCES|permission denied/i;
const EEXIST_ERROR = /EEXIST|file already exists/i;

/**
 * Resolves the npm binary path or writes an error and returns null.
 */
export function requireNpm(): string | null {
  const npmPath = resolveCommandPath('npm');
  if (!npmPath) {
    process.stderr.write(red(`${CROSS} npm not found in PATH. Install Node.js/npm first.\n`));
  }
  return npmPath;
}

/**
 * Runs `npm install -g @uxmaltech/collab-cli@<version>`.
 * Returns true on success, false on failure (with error already printed).
 */
export function npmGlobalInstall(npmPath: string, version: string): boolean {
  const spec = `${NPM_PACKAGE}@${version}`;

  // Try without --force first, then retry with --force on EEXIST
  for (const force of [false, true]) {
    try {
      const args = force
        ? ['install', '-g', '--force', spec]
        : ['install', '-g', spec];
      execFileSync(npmPath, args, {
        stdio: 'inherit',
        timeout: 60_000,
      });
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      // EEXIST: bin symlink collision — retry once with --force
      if (!force && EEXIST_ERROR.test(message)) {
        process.stderr.write('Retrying with --force to overwrite existing bin link...\n');
        continue;
      }

      if (PERMISSION_ERROR.test(message)) {
        process.stderr.write(
          red(`${CROSS} Permission denied. Try:\n`) +
          `  sudo npm install -g ${spec}\n`,
        );
      } else {
        process.stderr.write(red(`${CROSS} Install failed: ${message}\n`));
      }
      return false;
    }
  }

  return false;
}

/**
 * Runs `npm uninstall -g @uxmaltech/collab-cli`.
 * Returns true on success, false on failure (with error already printed).
 */
export function npmGlobalUninstall(npmPath: string): boolean {
  try {
    execFileSync(npmPath, ['uninstall', '-g', NPM_PACKAGE], {
      stdio: 'inherit',
      timeout: 60_000,
    });
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (PERMISSION_ERROR.test(message)) {
      process.stderr.write(
        red(`${CROSS} Permission denied. Try:\n`) +
        `  sudo npm uninstall -g ${NPM_PACKAGE}\n`,
      );
    } else {
      process.stderr.write(red(`${CROSS} Uninstall failed: ${message}\n`));
    }
    return false;
  }
}
