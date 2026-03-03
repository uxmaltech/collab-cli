import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { URL, URLSearchParams } from 'node:url';
import { execSync } from 'node:child_process';

import type { CollabConfig } from './config';
import type { Logger } from './logger';

export interface OAuthFlowConfig {
  provider: string;
  clientId: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  timeoutMs?: number;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  tokenType: string;
  scopes: string[];
}

interface PKCEPair {
  codeVerifier: string;
  codeChallenge: string;
}

function generatePKCE(): PKCEPair {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  return { codeVerifier, codeChallenge };
}

function openBrowser(url: string, logger: Logger): void {
  const platform = process.platform;

  try {
    if (platform === 'darwin') {
      execSync(`open ${JSON.stringify(url)}`, { stdio: 'ignore' });
    } else if (platform === 'linux') {
      execSync(`xdg-open ${JSON.stringify(url)}`, { stdio: 'ignore' });
    } else if (platform === 'win32') {
      execSync(`start "" ${JSON.stringify(url)}`, { stdio: 'ignore' });
    } else {
      logger.warn(`Unsupported platform '${platform}' for browser auto-open.`);
      logger.info(`Please open this URL manually:\n  ${url}`);
    }
  } catch {
    logger.warn('Could not open browser automatically.');
    logger.info(`Please open this URL manually:\n  ${url}`);
  }
}

function waitForAuthCode(
  port: number,
  timeoutMs: number,
): Promise<{ code: string; state: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);

      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        const errorDescription = url.searchParams.get('error_description') ?? error;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          '<html><body><h2>Authorization Failed</h2>' +
            `<p>${escapeHtml(errorDescription)}</p>` +
            '<p>You can close this window.</p></body></html>',
        );
        cleanup();
        reject(new Error(`OAuth authorization failed: ${errorDescription}`));
        return;
      }

      if (!code || !state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(
          '<html><body><h2>Invalid Response</h2>' +
            '<p>Missing authorization code or state.</p></body></html>',
        );
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<html><body><h2>Authorization Successful</h2>' +
          '<p>You can close this window and return to the terminal.</p></body></html>',
      );
      cleanup();
      resolve({ code, state });
    });

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`OAuth authorization timed out after ${timeoutMs / 1000} seconds.`));
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timer);
      server.close();
    }

    server.listen(port, '127.0.0.1', () => {
      // Server started, waiting for callback
    });

    server.on('error', (err) => {
      cleanup();
      reject(new Error(`Failed to start OAuth callback server: ${err.message}`));
    });
  });
}

function exchangeCodeForTokens(
  tokenUrl: string,
  params: Record<string, string>,
): Promise<OAuthTokens> {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const parsed = new URL(tokenUrl);

    const requestModule = parsed.protocol === 'https:' ? https : http;

    const req = requestModule.request(
      tokenUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body).toString(),
          Accept: 'application/json',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`Token exchange failed with status ${res.statusCode}: ${data}`));
            return;
          }

          try {
            const json = JSON.parse(data) as Record<string, unknown>;

            const accessToken = json.access_token;
            const refreshToken = json.refresh_token;
            const expiresIn = json.expires_in;

            if (typeof accessToken !== 'string') {
              reject(new Error('Token response missing access_token'));
              return;
            }

            const tokens: OAuthTokens = {
              accessToken,
              refreshToken: typeof refreshToken === 'string' ? refreshToken : undefined,
              tokenType: typeof json.token_type === 'string' ? json.token_type : 'Bearer',
              scopes:
                typeof json.scope === 'string' ? json.scope.split(' ') : params.scope?.split(' ') ?? [],
            };

            if (typeof expiresIn === 'number' && expiresIn > 0) {
              const expiresAt = new Date(Date.now() + expiresIn * 1000);
              tokens.expiresAt = expiresAt.toISOString();
            }

            resolve(tokens);
          } catch {
            reject(new Error(`Failed to parse token response: ${data}`));
          }
        });
      },
    );

    req.on('error', (err) => {
      reject(new Error(`Token exchange request failed: ${err.message}`));
    });

    req.write(body);
    req.end();
  });
}

function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address !== 'string') {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Could not determine available port')));
      }
    });
    server.on('error', reject);
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function runOAuthFlow(
  flowConfig: OAuthFlowConfig,
  logger: Logger,
): Promise<OAuthTokens> {
  const timeoutMs = flowConfig.timeoutMs ?? 120_000;
  const { codeVerifier, codeChallenge } = generatePKCE();
  const state = crypto.randomBytes(16).toString('hex');

  // Find available port for callback server
  const port = await findAvailablePort();
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  // Build authorization URL
  const authUrl = new URL(flowConfig.authorizationUrl);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', flowConfig.clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', flowConfig.scopes.join(' '));
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  logger.info('Opening browser for OAuth authorization...');
  logger.info(`  Authorization URL: ${authUrl.toString()}`);

  // Start listening for callback before opening browser
  const callbackPromise = waitForAuthCode(port, timeoutMs);

  // Open browser
  openBrowser(authUrl.toString(), logger);

  logger.info('Waiting for authorization (press Ctrl+C to cancel)...');

  // Wait for auth code
  const { code, state: returnedState } = await callbackPromise;

  // Verify state
  if (returnedState !== state) {
    throw new Error('OAuth state mismatch — possible CSRF attack. Aborting.');
  }

  logger.info('Authorization code received. Exchanging for tokens...');

  // Exchange code for tokens
  const tokens = await exchangeCodeForTokens(flowConfig.tokenUrl, {
    grant_type: 'authorization_code',
    client_id: flowConfig.clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  logger.info('OAuth tokens obtained successfully.');

  return tokens;
}

export async function refreshOAuthToken(
  tokenUrl: string,
  clientId: string,
  refreshToken: string,
): Promise<OAuthTokens> {
  return exchangeCodeForTokens(tokenUrl, {
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
  });
}

export function getTokenFilePath(config: CollabConfig, provider: string): string {
  return path.join(config.collabDir, 'tokens', `${provider}.json`);
}

export function saveTokens(config: CollabConfig, provider: string, tokens: OAuthTokens): void {
  const tokenFile = getTokenFilePath(config, provider);
  const tokenDir = path.dirname(tokenFile);

  fs.mkdirSync(tokenDir, { recursive: true });
  fs.writeFileSync(tokenFile, JSON.stringify(tokens, null, 2), { encoding: 'utf8', mode: 0o600 });

  // Ensure tokens directory has restricted permissions
  try {
    fs.chmodSync(tokenDir, 0o700);
  } catch {
    // Non-critical: permissions may not be applicable on all platforms
  }
}

export function loadTokens(config: CollabConfig, provider: string): OAuthTokens | null {
  const tokenFile = getTokenFilePath(config, provider);

  if (!fs.existsSync(tokenFile)) {
    return null;
  }

  const raw = fs.readFileSync(tokenFile, 'utf8');
  return JSON.parse(raw) as OAuthTokens;
}

export function isTokenExpired(tokens: OAuthTokens): boolean {
  if (!tokens.expiresAt) {
    return false;
  }

  const expiresAt = new Date(tokens.expiresAt).getTime();
  // Consider expired 60 seconds before actual expiration
  return Date.now() > expiresAt - 60_000;
}

// Exported for testing
export { generatePKCE, findAvailablePort };
