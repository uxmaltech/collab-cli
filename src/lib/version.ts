import fs from 'node:fs';
import path from 'node:path';

const PACKAGE_JSON_PATH = path.resolve(__dirname, '../../package.json');

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
