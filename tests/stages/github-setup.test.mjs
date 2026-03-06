import assert from 'node:assert/strict';
import test from 'node:test';

import { runCli } from '../helpers/cli.mjs';
import { createFakeDockerEnv } from '../helpers/fake-docker.mjs';
import { makeMultiRepoWorkspace } from '../helpers/workspace.mjs';

test('github-setup stage appears in indexed pipeline dry-run', () => {
  const workspace = makeMultiRepoWorkspace(['svc1', 'svc2']);
  const env = createFakeDockerEnv();

  const result = runCli(
    [
      '--cwd', workspace, '--dry-run', 'init', '--yes',
      '--business-canon', 'uxmaltech/collab-architecture',
      '--github-token', 'fake-token',
      '--repos', 'svc1,svc2',
      '--mode', 'indexed',
    ],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `should succeed, got:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('github-setup') || result.stdout.includes('GitHub branch model'),
    `should show github-setup stage, got:\n${result.stdout}`,
  );
});

test('--skip-github-setup flag is accepted', () => {
  const workspace = makeMultiRepoWorkspace(['svc1', 'svc2']);
  const env = createFakeDockerEnv();

  const result = runCli(
    [
      '--cwd', workspace, '--dry-run', 'init', '--yes',
      '--business-canon', 'uxmaltech/collab-architecture',
      '--github-token', 'fake-token',
      '--repos', 'svc1,svc2',
      '--mode', 'indexed',
      '--skip-github-setup',
    ],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `should accept --skip-github-setup flag, got:\nstderr: ${result.stderr}`);
});

test('github-setup does not appear in file-only pipeline', () => {
  const workspace = makeMultiRepoWorkspace(['svc1', 'svc2']);
  const env = createFakeDockerEnv();

  const result = runCli(
    [
      '--cwd', workspace, '--dry-run', 'init', '--yes',
      '--business-canon', 'none',
      '--mode', 'file-only',
    ],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `should succeed, got:\nstderr: ${result.stderr}`);
  assert.ok(
    !result.stdout.includes('github-setup'),
    'file-only pipeline should not contain github-setup stage',
  );
});
