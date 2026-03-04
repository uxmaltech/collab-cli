import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { makeTempWorkspace } from '../helpers/workspace.mjs';

const { saveApiKey, loadApiKey, getCredentialsPath } = await import('../../dist/lib/credentials.js');

function makeTestConfig(workspace) {
  return {
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
    architectureDir: path.join(workspace, 'docs', 'architecture'),
  };
}

test('getCredentialsPath returns correct path', () => {
  const config = { collabDir: '/workspace/.collab' };
  const credPath = getCredentialsPath(config);
  assert.equal(credPath, path.join('/workspace/.collab', 'credentials.json'));
});

test('saveApiKey and loadApiKey round-trip', () => {
  const workspace = makeTempWorkspace();
  const config = makeTestConfig(workspace);

  saveApiKey(config, 'codex', 'sk-test-openai-key');

  const loaded = loadApiKey(config, 'codex');
  assert.equal(loaded, 'sk-test-openai-key');
});

test('saveApiKey creates credentials file with restricted permissions', () => {
  const workspace = makeTempWorkspace();
  const config = makeTestConfig(workspace);

  saveApiKey(config, 'claude', 'sk-ant-test-key');

  const credPath = getCredentialsPath(config);
  assert.ok(fs.existsSync(credPath), 'credentials file should exist');

  // Verify permissions (Unix only)
  if (process.platform !== 'win32') {
    const stats = fs.statSync(credPath);
    const mode = stats.mode & 0o777;
    assert.equal(mode, 0o600, `credentials file should have 0600 permissions, got ${mode.toString(8)}`);
  }
});

test('saveApiKey preserves existing credentials for other providers', () => {
  const workspace = makeTempWorkspace();
  const config = makeTestConfig(workspace);

  saveApiKey(config, 'codex', 'sk-openai');
  saveApiKey(config, 'claude', 'sk-ant');

  assert.equal(loadApiKey(config, 'codex'), 'sk-openai');
  assert.equal(loadApiKey(config, 'claude'), 'sk-ant');
});

test('saveApiKey overwrites existing key for same provider', () => {
  const workspace = makeTempWorkspace();
  const config = makeTestConfig(workspace);

  saveApiKey(config, 'codex', 'sk-old');
  saveApiKey(config, 'codex', 'sk-new');

  assert.equal(loadApiKey(config, 'codex'), 'sk-new');
});

test('loadApiKey returns null for non-existent provider', () => {
  const workspace = makeTempWorkspace();
  const config = makeTestConfig(workspace);

  const loaded = loadApiKey(config, 'gemini');
  assert.equal(loaded, null);
});

test('loadApiKey returns null when credentials file does not exist', () => {
  const workspace = makeTempWorkspace();
  const config = makeTestConfig(workspace);

  const loaded = loadApiKey(config, 'codex');
  assert.equal(loaded, null);
});
