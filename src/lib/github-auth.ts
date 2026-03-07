import fs from 'node:fs';
import path from 'node:path';

import { startSpinner } from './spinner';

/**
 * GitHub OAuth Device Flow for workspace-scoped authentication.
 *
 * Token is stored in `.collab/github-auth.json` and MUST be in `.gitignore`.
 * It is NEVER logged, stored in config.json, or exposed to stage pipelines.
 */

const AUTH_FILENAME = 'github-auth.json';

/**
 * Client ID for the collab-cli GitHub OAuth App.
 * Override with COLLAB_GITHUB_CLIENT_ID env var for custom OAuth apps.
 */
const DEFAULT_CLIENT_ID = process.env.COLLAB_GITHUB_CLIENT_ID ?? 'Ov23liocAEoUmWO39r5B';

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const SCOPES = 'repo read:org read:project';

export interface GitHubAuth {
  provider: 'github';
  token: string;
  scopes: string[];
  created_at: string;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

// ────────────────────────────────────────────────────────────────
// Token persistence
// ────────────────────────────────────────────────────────────────

function authFilePath(collabDir: string): string {
  return path.join(collabDir, AUTH_FILENAME);
}

/**
 * Loads the GitHub auth token from `.collab/github-auth.json`.
 * Returns null if the file does not exist or cannot be parsed.
 */
export function loadGitHubAuth(collabDir: string): GitHubAuth | null {
  const filePath = authFilePath(collabDir);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as GitHubAuth;

    if (!parsed.token || parsed.provider !== 'github') {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function saveGitHubAuth(collabDir: string, auth: GitHubAuth): void {
  fs.mkdirSync(collabDir, { recursive: true });
  fs.writeFileSync(authFilePath(collabDir), JSON.stringify(auth, null, 2) + '\n', 'utf8');
}

// ────────────────────────────────────────────────────────────────
// Token validation
// ────────────────────────────────────────────────────────────────

/**
 * Validates the GitHub token by calling `GET /user`.
 * Returns true if the token is valid and has the expected scopes.
 */
export async function isGitHubAuthValid(auth: GitHubAuth): Promise<boolean> {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${auth.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    return response.ok;
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────────────────────
// .gitignore management
// ────────────────────────────────────────────────────────────────

/**
 * Ensures `.collab/.gitignore` contains `github-auth.json`.
 */
export function ensureAuthGitIgnore(collabDir: string): void {
  const gitignorePath = path.join(collabDir, '.gitignore');

  let content = '';
  if (fs.existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, 'utf8');
  }

  if (content.includes(AUTH_FILENAME)) {
    return;
  }

  const newLine = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(gitignorePath, `${content}${newLine}${AUTH_FILENAME}\n`, 'utf8');
}

// ────────────────────────────────────────────────────────────────
// OAuth Device Flow
// ────────────────────────────────────────────────────────────────

async function requestDeviceCode(clientId: string): Promise<DeviceCodeResponse> {
  const response = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      scope: SCOPES,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub device code request failed (${response.status}): ${text}`);
  }

  return (await response.json()) as DeviceCodeResponse;
}

async function pollForAccessToken(
  clientId: string,
  deviceCode: string,
  interval: number,
  expiresIn: number,
): Promise<string> {
  const deadline = Date.now() + expiresIn * 1000;
  let pollInterval = interval * 1000;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    const response = await fetch(ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    const body = (await response.json()) as Record<string, string>;

    if (body.access_token) {
      return body.access_token;
    }

    if (body.error === 'authorization_pending') {
      continue;
    }

    if (body.error === 'slow_down') {
      pollInterval += 5000;
      continue;
    }

    if (body.error === 'expired_token') {
      throw new Error('GitHub device code expired. Please try again.');
    }

    if (body.error === 'access_denied') {
      throw new Error('GitHub authorization was denied by the user.');
    }

    throw new Error(`GitHub OAuth error: ${body.error ?? 'unknown'}`);
  }

  throw new Error('GitHub device code expired. Please try again.');
}

/**
 * Runs the GitHub OAuth Device Flow interactively.
 *
 * 1. Requests a device code from GitHub
 * 2. Displays the user code and opens the browser
 * 3. Polls until the user authorizes or the code expires
 * 4. Stores the token in `.collab/github-auth.json`
 */
export async function runGitHubDeviceFlow(
  collabDir: string,
  log?: (msg: string) => void,
): Promise<GitHubAuth> {
  const print = log ?? console.log;
  const clientId = process.env.COLLAB_GITHUB_CLIENT_ID ?? DEFAULT_CLIENT_ID;

  if (!clientId) {
    throw new Error(
      'GitHub OAuth client ID not configured. Set COLLAB_GITHUB_CLIENT_ID environment variable.',
    );
  }

  print('Authorizing collab-cli with GitHub...');

  const deviceCode = await requestDeviceCode(clientId);

  print('');
  print(`  Open: ${deviceCode.verification_uri}`);
  print(`  Code: ${deviceCode.user_code}`);
  print('');
  const spinner = await startSpinner('Waiting for authorization...');

  const token = await pollForAccessToken(
    clientId,
    deviceCode.device_code,
    deviceCode.interval,
    deviceCode.expires_in,
  );

  const auth: GitHubAuth = {
    provider: 'github',
    token,
    scopes: SCOPES.split(' '),
    created_at: new Date().toISOString(),
  };

  saveGitHubAuth(collabDir, auth);
  ensureAuthGitIgnore(collabDir);

  spinner.stop('GitHub authorization complete.');

  return auth;
}

/**
 * Stores a pre-existing token (e.g. from `--github-token` flag).
 */
export function storeGitHubToken(collabDir: string, token: string): GitHubAuth {
  const auth: GitHubAuth = {
    provider: 'github',
    token,
    scopes: SCOPES.split(' '),
    created_at: new Date().toISOString(),
  };

  saveGitHubAuth(collabDir, auth);
  ensureAuthGitIgnore(collabDir);

  return auth;
}
