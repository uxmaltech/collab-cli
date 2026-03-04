import fs from 'node:fs';
import path from 'node:path';

import type { CollabConfig } from './config';
import type { ProviderKey } from './providers';

/**
 * Simple credential store for API keys.
 *
 * Credentials are stored in `.collab/credentials.json` with restricted
 * file permissions (0600). This file should be gitignored.
 *
 * Resolution order in ai-client:
 *   1. Environment variable (e.g. OPENAI_API_KEY)
 *   2. Stored credential from this module
 */

interface CredentialsFile {
  [provider: string]: string;
}

export function getCredentialsPath(config: CollabConfig): string {
  return path.join(config.collabDir, 'credentials.json');
}

/**
 * Saves an API key for a provider to the credentials file.
 */
export function saveApiKey(config: CollabConfig, provider: ProviderKey, apiKey: string): void {
  const credPath = getCredentialsPath(config);
  const credDir = path.dirname(credPath);

  // Ensure .collab directory exists
  fs.mkdirSync(credDir, { recursive: true });

  // Load existing credentials
  const existing = loadAllCredentials(config);
  existing[provider] = apiKey;

  // Write with restricted permissions
  fs.writeFileSync(credPath, JSON.stringify(existing, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });

  // Ensure permissions on directory and file
  try {
    fs.chmodSync(credDir, 0o700);
    fs.chmodSync(credPath, 0o600);
  } catch {
    // Non-critical: permissions may not be applicable on all platforms
  }
}

/**
 * Loads the API key for a single provider from the credentials file.
 * Returns null if not found.
 */
export function loadApiKey(config: CollabConfig, provider: ProviderKey): string | null {
  const all = loadAllCredentials(config);
  return all[provider] ?? null;
}

/**
 * Loads all stored credentials. Returns an empty object if the file
 * does not exist or cannot be parsed.
 */
function loadAllCredentials(config: CollabConfig): CredentialsFile {
  const credPath = getCredentialsPath(config);

  if (!fs.existsSync(credPath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(credPath, 'utf8');
    return JSON.parse(raw) as CredentialsFile;
  } catch {
    return {};
  }
}
