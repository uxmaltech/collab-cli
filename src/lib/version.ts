import fs from 'node:fs';
import path from 'node:path';

/** Resolved path to the CLI's own package.json. */
const PACKAGE_JSON_PATH = path.resolve(__dirname, '../../package.json');

/**
 * Reads the CLI version from the CLI's own `package.json`.
 * Returns `'0.0.0'` when the file cannot be read or parsed.
 */
export function readCliVersion(): string {
  try {
    const raw = fs.readFileSync(PACKAGE_JSON_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };

    if (typeof parsed.version === 'string' && parsed.version.length > 0) {
      return parsed.version;
    }
  } catch {
    // Fall back to a neutral value when package metadata cannot be read.
  }

  return '0.0.0';
}
