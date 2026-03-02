import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runCli } from './helpers/cli.mjs';

function makeTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'collab-cli-'));
}

test('compose generate (consolidated) is idempotent and preserves .env overrides', () => {
  const workspace = makeTempWorkspace();

  const first = runCli(
    ['--cwd', workspace, 'compose', 'generate', '--mode', 'consolidated', '--skip-validate'],
    { cwd: workspace },
  );
  assert.equal(first.status, 0, first.stderr);

  const composePath = path.join(workspace, 'docker-compose.yml');
  const envPath = path.join(workspace, '.env');
  const statePath = path.join(workspace, '.collab', 'state.json');

  assert.equal(fs.existsSync(composePath), true);
  assert.equal(fs.existsSync(envPath), true);
  assert.equal(fs.existsSync(statePath), true);

  const firstCompose = fs.readFileSync(composePath, 'utf8');

  const second = runCli(
    ['--cwd', workspace, 'compose', 'generate', '--mode', 'consolidated', '--skip-validate'],
    { cwd: workspace },
  );
  assert.equal(second.status, 0, second.stderr);

  const secondCompose = fs.readFileSync(composePath, 'utf8');
  assert.equal(secondCompose, firstCompose);

  fs.appendFileSync(envPath, '\nQDRANT_PORT=7000\nCUSTOM_VAR=abc\n', 'utf8');

  const third = runCli(
    ['--cwd', workspace, 'compose', 'generate', '--mode', 'consolidated', '--skip-validate'],
    { cwd: workspace },
  );
  assert.equal(third.status, 0, third.stderr);

  const mergedEnv = fs.readFileSync(envPath, 'utf8');
  assert.match(mergedEnv, /^QDRANT_PORT=7000$/m);
  assert.match(mergedEnv, /^CUSTOM_VAR=abc$/m);

  fs.appendFileSync(composePath, '\n# manual edit\n', 'utf8');

  const fourth = runCli(
    ['--cwd', workspace, 'compose', 'generate', '--mode', 'consolidated', '--skip-validate'],
    { cwd: workspace },
  );
  assert.equal(fourth.status, 0, fourth.stderr);
  assert.match(fourth.stderr, /Manual edits detected/);
});

test('compose generate (split) creates infra and mcp files with shared network name', () => {
  const workspace = makeTempWorkspace();

  const result = runCli(
    ['--cwd', workspace, 'compose', 'generate', '--mode', 'split', '--skip-validate'],
    { cwd: workspace },
  );
  assert.equal(result.status, 0, result.stderr);

  const infraPath = path.join(workspace, 'docker-compose.infra.yml');
  const mcpPath = path.join(workspace, 'docker-compose.mcp.yml');

  assert.equal(fs.existsSync(infraPath), true);
  assert.equal(fs.existsSync(mcpPath), true);

  const infraContent = fs.readFileSync(infraPath, 'utf8');
  const mcpContent = fs.readFileSync(mcpPath, 'utf8');

  assert.match(infraContent, /name: \$\{COLLAB_NETWORK\}/);
  assert.match(mcpContent, /external: true/);
  assert.match(mcpContent, /name: \$\{COLLAB_NETWORK\}/);
});

test('compose validate fails fast with file-path context when file is missing', () => {
  const workspace = makeTempWorkspace();
  const missing = path.join(workspace, 'missing-compose.yml');

  const result = runCli(
    ['--cwd', workspace, 'compose', 'validate', '--file', missing],
    { cwd: workspace },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`Compose file not found: ${missing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});
