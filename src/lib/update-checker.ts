import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import semver from 'semver';

import { readCliVersion } from './version';

const NPM_PACKAGE_NAME = '@uxmaltech/collab-cli';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 5_000;

export interface UpdateCheckState {
  lastCheck: string;
  latestVersion: string;
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
}

// ── State file helpers ──────────────────────────────────────────────

function getCheckFilePath(): string {
  const collabHome = process.env.COLLAB_HOME ?? path.join(os.homedir(), '.collab');
  return path.join(collabHome, 'update-check.json');
}

export function readCheckState(filePath?: string): UpdateCheckState | null {
  const target = filePath ?? getCheckFilePath();
  try {
    const raw = fs.readFileSync(target, 'utf8');
    const parsed = JSON.parse(raw) as Partial<UpdateCheckState>;
    if (typeof parsed.lastCheck === 'string' && typeof parsed.latestVersion === 'string') {
      return parsed as UpdateCheckState;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeCheckState(state: UpdateCheckState, filePath?: string): void {
  const target = filePath ?? getCheckFilePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

export function shouldCheck(state: UpdateCheckState | null): boolean {
  if (!state) return true;
  const elapsed = Date.now() - Date.parse(state.lastCheck);
  return elapsed > CHECK_INTERVAL_MS;
}

// ── Registry fetch ──────────────────────────────────────────────────

export async function fetchLatestVersion(packageName?: string): Promise<string | null> {
  const name = packageName ?? NPM_PACKAGE_NAME;
  const url = `https://registry.npmjs.org/${name}/latest`;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as { version?: string };
    if (typeof payload.version === 'string' && payload.version.length > 0) {
      return payload.version;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Update check ────────────────────────────────────────────────────

export async function checkForUpdate(stateFilePath?: string): Promise<UpdateCheckResult | null> {
  try {
    const currentVersion = readCliVersion();
    const latestVersion = await fetchLatestVersion();

    if (!latestVersion) return null;

    const state: UpdateCheckState = {
      lastCheck: new Date().toISOString(),
      latestVersion,
    };
    writeCheckState(state, stateFilePath);

    return {
      updateAvailable: semver.gt(latestVersion, currentVersion),
      currentVersion,
      latestVersion,
    };
  } catch {
    return null;
  }
}

// ── Daily notification banner ───────────────────────────────────────

export async function maybeNotifyUpdate(): Promise<void> {
  try {
    const state = readCheckState();

    if (shouldCheck(state)) {
      const result = await checkForUpdate();
      if (result?.updateAvailable) {
        printUpdateBanner(result.currentVersion, result.latestVersion);
      }
      return;
    }

    // If we have a cached state that indicates an update is available,
    // show the banner even if we don't re-check
    if (state) {
      const currentVersion = readCliVersion();
      if (semver.gt(state.latestVersion, currentVersion)) {
        printUpdateBanner(currentVersion, state.latestVersion);
      }
    }
  } catch {
    // Silent failure — update check should never break the CLI
  }
}

function printUpdateBanner(currentVersion: string, latestVersion: string): void {
  const line1 = `  Update available: ${currentVersion} → ${latestVersion}`;
  const line2 = '  Run: npm install -g @uxmaltech/collab-cli';
  const line3 = '  Or:  collab upgrade';

  const maxLen = Math.max(line1.length, line2.length, line3.length);
  const border = '─'.repeat(maxLen + 2);

  process.stderr.write('\n');
  process.stderr.write(`╭${border}╮\n`);
  process.stderr.write(`│${line1.padEnd(maxLen + 2)}│\n`);
  process.stderr.write(`│${line2.padEnd(maxLen + 2)}│\n`);
  process.stderr.write(`│${line3.padEnd(maxLen + 2)}│\n`);
  process.stderr.write(`╰${border}╯\n`);
  process.stderr.write('\n');
}
