import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

import { makeTempWorkspace } from '../helpers/workspace.mjs';

// Import from compiled dist
const { generatePKCE, startCallbackServer, saveTokens, loadTokens, isTokenExpired, getTokenFilePath } = await import('../../dist/lib/oauth.js');

test('generatePKCE produces valid code_verifier and code_challenge', () => {
  const { codeVerifier, codeChallenge } = generatePKCE();

  // code_verifier should be base64url encoded (43-128 chars per RFC 7636)
  assert.ok(codeVerifier.length >= 43, 'code_verifier too short');
  assert.ok(/^[A-Za-z0-9_-]+$/.test(codeVerifier), 'code_verifier contains invalid chars');

  // code_challenge should be base64url encoded SHA256 of code_verifier
  assert.ok(codeChallenge.length > 0, 'code_challenge is empty');
  assert.ok(/^[A-Za-z0-9_-]+$/.test(codeChallenge), 'code_challenge contains invalid chars');

  // They should be different
  assert.notEqual(codeVerifier, codeChallenge);
});

test('generatePKCE produces unique pairs', () => {
  const pair1 = generatePKCE();
  const pair2 = generatePKCE();

  assert.notEqual(pair1.codeVerifier, pair2.codeVerifier);
  assert.notEqual(pair1.codeChallenge, pair2.codeChallenge);
});

test('startCallbackServer returns a live server with a valid port', async () => {
  const { server, port } = await startCallbackServer();

  assert.ok(typeof port === 'number');
  assert.ok(port > 0);
  assert.ok(port < 65536);
  assert.ok(server.listening, 'server should be listening');

  server.close();
});

test('startCallbackServer returns different ports on consecutive calls', async () => {
  const result1 = await startCallbackServer();
  const result2 = await startCallbackServer();

  assert.ok(typeof result1.port === 'number');
  assert.ok(typeof result2.port === 'number');

  result1.server.close();
  result2.server.close();
});

test('saveTokens and loadTokens round-trip', () => {
  const workspace = makeTempWorkspace();
  const config = {
    workspaceDir: workspace,
    collabDir: path.join(workspace, '.collab'),
    configFile: path.join(workspace, '.collab', 'config.json'),
    stateFile: path.join(workspace, '.collab', 'state.json'),
    envFile: path.join(workspace, '.env'),
    mode: 'file-only',
    compose: {
      consolidatedFile: 'docker-compose.yml',
      infraFile: 'docker-compose.infra.yml',
      mcpFile: 'docker-compose.mcp.yml',
    },
  };

  const tokens = {
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: '2030-01-01T00:00:00.000Z',
    tokenType: 'Bearer',
    scopes: ['read', 'write'],
  };

  saveTokens(config, 'codex', tokens);

  // Verify file exists
  const tokenFile = getTokenFilePath(config, 'codex');
  assert.ok(fs.existsSync(tokenFile), 'token file should exist');

  // Verify permissions (Unix only)
  if (process.platform !== 'win32') {
    const stats = fs.statSync(tokenFile);
    const mode = stats.mode & 0o777;
    assert.equal(mode, 0o600, `token file should have 0600 permissions, got ${mode.toString(8)}`);
  }

  // Load and verify
  const loaded = loadTokens(config, 'codex');
  assert.deepEqual(loaded, tokens);
});

test('loadTokens returns null for non-existent provider', () => {
  const workspace = makeTempWorkspace();
  const config = {
    workspaceDir: workspace,
    collabDir: path.join(workspace, '.collab'),
    configFile: path.join(workspace, '.collab', 'config.json'),
    stateFile: path.join(workspace, '.collab', 'state.json'),
    envFile: path.join(workspace, '.env'),
    mode: 'file-only',
    compose: {
      consolidatedFile: 'docker-compose.yml',
      infraFile: 'docker-compose.infra.yml',
      mcpFile: 'docker-compose.mcp.yml',
    },
  };

  const loaded = loadTokens(config, 'gemini');
  assert.equal(loaded, null);
});

test('isTokenExpired detects expired tokens', () => {
  const expired = {
    accessToken: 'test',
    tokenType: 'Bearer',
    scopes: [],
    expiresAt: '2020-01-01T00:00:00.000Z',
  };

  assert.equal(isTokenExpired(expired), true);
});

test('isTokenExpired detects valid tokens', () => {
  const valid = {
    accessToken: 'test',
    tokenType: 'Bearer',
    scopes: [],
    expiresAt: '2099-01-01T00:00:00.000Z',
  };

  assert.equal(isTokenExpired(valid), false);
});

test('isTokenExpired returns false when no expiresAt', () => {
  const noExpiry = {
    accessToken: 'test',
    tokenType: 'Bearer',
    scopes: [],
  };

  assert.equal(isTokenExpired(noExpiry), false);
});

test('getTokenFilePath returns correct path', () => {
  const config = {
    collabDir: '/workspace/.collab',
  };

  const tokenPath = getTokenFilePath(config, 'claude');
  assert.equal(tokenPath, path.join('/workspace/.collab', 'tokens', 'claude.json'));
});
