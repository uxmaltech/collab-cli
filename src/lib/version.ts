import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Resolved path to the CLI's own package.json. */
const PACKAGE_JSON_PATH = path.resolve(__dirname, '../../package.json');

/** Root of the CLI project (where package.json lives). */
const PROJECT_ROOT = path.resolve(__dirname, '../..');

/**
 * Returns the short git commit hash when running from a git clone.
 * Returns `null` when installed via npm (no .git directory).
 */
function getGitHash(): string | null {
  try {
    if (!fs.existsSync(path.join(PROJECT_ROOT, '.git'))) {
      return null;
    }
    return execFileSync('git', ['-C', PROJECT_ROOT, 'rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Reads the CLI version from the CLI's own `package.json`.
 * When running from a git clone, appends `+<commit-hash>` so users
 * can identify the exact build without bumping the semver.
 * Returns `'0.0.0'` when the file cannot be read or parsed.
 */
export function readCliVersion(): string {
  let version = '0.0.0';

  try {
    const raw = fs.readFileSync(PACKAGE_JSON_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };

    if (typeof parsed.version === 'string' && parsed.version.length > 0) {
      version = parsed.version;
    }
  } catch {
    // Fall back to a neutral value when package metadata cannot be read.
  }

  const hash = getGitHash();
  return hash ? `${version}+${hash}` : version;
}
