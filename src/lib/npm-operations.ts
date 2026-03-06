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

  // First attempt: pipe stderr so we can inspect it for EEXIST
  try {
    execFileSync(npmPath, ['install', '-g', spec], {
      stdio: ['inherit', 'inherit', 'pipe'],
      timeout: 60_000,
    });
    return true;
  } catch (firstError: unknown) {
    // Extract stderr from the failed child process
    const stderr = extractStderr(firstError);

    if (!EEXIST_ERROR.test(stderr)) {
      // Not an EEXIST error — report and bail
      process.stderr.write(stderr);
      reportInstallError(spec, firstError);
      return false;
    }

    // EEXIST: bin symlink collision — retry with --force
    process.stderr.write('Bin link conflict detected, retrying with --force...\n');
  }

  // Second attempt with --force (stdio: inherit for full visibility)
  try {
    execFileSync(npmPath, ['install', '-g', '--force', spec], {
      stdio: 'inherit',
      timeout: 60_000,
    });
    return true;
  } catch (error: unknown) {
    reportInstallError(spec, error);
    return false;
  }
}

function extractStderr(error: unknown): string {
  if (error && typeof error === 'object' && 'stderr' in error) {
    const buf = (error as { stderr: Buffer | string }).stderr;
    return typeof buf === 'string' ? buf : buf?.toString('utf8') ?? '';
  }
  return '';
}

function reportInstallError(spec: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const stderr = extractStderr(error);

  if (PERMISSION_ERROR.test(message) || PERMISSION_ERROR.test(stderr)) {
    process.stderr.write(
      red(`${CROSS} Permission denied. Try:\n`) +
      `  sudo npm install -g ${spec}\n`,
    );
  } else {
    process.stderr.write(red(`${CROSS} Install failed: ${message}\n`));
  }
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
