import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../helpers/cli.mjs';
import { createFakeDockerEnv } from '../helpers/fake-docker.mjs';
import { makeTempWorkspace } from '../helpers/workspace.mjs';

test('indexed mode runs canon-sync instead of canon-scaffold (dry-run)', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  // Indexed mode requires GitHub business canon + multi-repo workspace
  fs.mkdirSync(path.join(workspace, 'svc1', '.git'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'svc2', '.git'), { recursive: true });

  const result = runCli(
    [
      '--cwd', workspace, '--dry-run', 'init', '--yes',
      '--business-canon', 'uxmaltech/collab-architecture',
      '--github-token', 'fake-token-for-test',
      '--repos', 'svc1,svc2',
      '--mode', 'indexed',
    ],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('Sync canonical architecture'),
    'canon-sync should run in indexed mode',
  );
  assert.ok(
    !result.stdout.includes('Generate canonical architecture scaffold'),
    'canon-scaffold should NOT run in indexed mode',
  );
});

test('indexed mode has repo-scaffold, agent-skills-setup, and graph-seed (dry-run)', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  // Indexed mode requires GitHub business canon + multi-repo workspace
  fs.mkdirSync(path.join(workspace, 'svc1', '.git'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'svc2', '.git'), { recursive: true });

  const result = runCli(
    [
      '--cwd', workspace, '--dry-run', 'init', '--yes',
      '--business-canon', 'uxmaltech/collab-architecture',
      '--github-token', 'fake-token-for-test',
      '--repos', 'svc1,svc2',
      '--mode', 'indexed',
    ],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('Generate project architecture scaffold'),
    'repo-scaffold should appear in indexed pipeline',
  );
  assert.ok(
    result.stdout.includes('Generate agent skill files'),
    'agent-skills-setup should appear in indexed pipeline',
  );
  assert.ok(
    result.stdout.includes('Seed NebulaGraph knowledge graph'),
    'graph-seed should appear in indexed pipeline',
  );
  assert.ok(
    !result.stdout.includes('Optional ingest bootstrap'),
    'ingest-bootstrap should NOT appear in indexed pipeline',
  );
});

test('file-only mode runs canon-sync and repo-scaffold (dry-run)', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', 'none', '--mode', 'file-only'],
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
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', 'none', '--mode', 'file-only'],
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
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', 'none', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('Generate agent skill files'),
    'agent-skills-setup should appear in file-only pipeline',
  );
});
