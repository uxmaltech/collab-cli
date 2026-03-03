import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../helpers/cli.mjs';
import { createFakeDockerEnv } from '../helpers/fake-docker.mjs';
import { makeTempWorkspace } from '../helpers/workspace.mjs';

test('canon-scaffold stage runs in indexed mode (dry-run)', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--mode', 'indexed'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('Generate canonical architecture scaffold') ||
      result.stdout.includes('scaffold governance'),
    'canon-scaffold should run in indexed mode',
  );
});

test('file-only mode runs canon-sync and repo-scaffold (dry-run)', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('Sync canonical architecture'),
    'canon-sync should appear in file-only pipeline',
  );
  assert.ok(
    result.stdout.includes('Generate project architecture scaffold'),
    'repo-scaffold should appear in file-only pipeline',
  );
});

test('file-only pipeline does not contain indexed-only stages (dry-run)', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);

  // Indexed-only stages should NOT appear
  assert.ok(
    !result.stdout.includes('Generate and validate compose files'),
    'compose stage should not be in file-only pipeline',
  );
  assert.ok(
    !result.stdout.includes('Start infrastructure services'),
    'infra stage should not be in file-only pipeline',
  );
  assert.ok(
    !result.stdout.includes('Start MCP service'),
    'MCP stage should not be in file-only pipeline',
  );
});

test('file-only mode has agent-skills-setup stage (dry-run)', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('Generate agent skill files'),
    'agent-skills-setup should appear in file-only pipeline',
  );
});
