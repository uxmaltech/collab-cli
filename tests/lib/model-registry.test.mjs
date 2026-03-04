import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { makeTempWorkspace } from '../helpers/workspace.mjs';

const { saveProviderModels, loadProviderModels, loadRegistry, getRegistryPath } = await import('../../dist/lib/model-registry.js');

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

test('getRegistryPath returns correct path', () => {
  const config = { collabDir: '/workspace/.collab' };
  assert.equal(getRegistryPath(config), path.join('/workspace/.collab', 'models.json'));
});

test('loadRegistry returns empty registry when file does not exist', () => {
  const workspace = makeTempWorkspace();
  const config = makeTestConfig(workspace);

  const registry = loadRegistry(config);
  assert.ok(registry.updatedAt, 'should have updatedAt');
  assert.deepEqual(registry.providers, {});
});

test('saveProviderModels and loadProviderModels round-trip', () => {
  const workspace = makeTempWorkspace();
  const config = makeTestConfig(workspace);

  const models = [
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  ];

  saveProviderModels(config, 'gemini', models);

  const entry = loadProviderModels(config, 'gemini');
  assert.ok(entry, 'should return an entry');
  assert.ok(entry.queriedAt, 'should have queriedAt');
  assert.deepEqual(entry.models, models);
});

test('saveProviderModels preserves entries for other providers', () => {
  const workspace = makeTempWorkspace();
  const config = makeTestConfig(workspace);

  saveProviderModels(config, 'codex', [{ id: 'gpt-4.1' }]);
  saveProviderModels(config, 'gemini', [{ id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }]);

  const codex = loadProviderModels(config, 'codex');
  const gemini = loadProviderModels(config, 'gemini');

  assert.ok(codex, 'codex entry should exist');
  assert.deepEqual(codex.models, [{ id: 'gpt-4.1' }]);

  assert.ok(gemini, 'gemini entry should exist');
  assert.deepEqual(gemini.models, [{ id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }]);
});

test('loadProviderModels returns null for non-existent provider', () => {
  const workspace = makeTempWorkspace();
  const config = makeTestConfig(workspace);

  saveProviderModels(config, 'codex', [{ id: 'gpt-4.1' }]);

  const result = loadProviderModels(config, 'claude');
  assert.equal(result, null);
});

test('registry file is valid JSON', () => {
  const workspace = makeTempWorkspace();
  const config = makeTestConfig(workspace);

  saveProviderModels(config, 'codex', [{ id: 'o3-pro' }]);

  const registryPath = getRegistryPath(config);
  const raw = fs.readFileSync(registryPath, 'utf8');
  const parsed = JSON.parse(raw);

  assert.ok(parsed.updatedAt);
  assert.ok(parsed.providers.codex);
  assert.ok(parsed.providers.codex.queriedAt);
  assert.deepEqual(parsed.providers.codex.models, [{ id: 'o3-pro' }]);
});
