import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../helpers/cli.mjs';
import { createFakeDockerEnv } from '../helpers/fake-docker.mjs';
import { makeTempWorkspace, makeMultiRepoWorkspace } from '../helpers/workspace.mjs';

test('indexed rejects --business-canon none', () => {
  const workspace = makeMultiRepoWorkspace(['svc1', 'svc2']);
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', 'none', '--repos', 'svc1,svc2', '--mode', 'indexed'],
    { cwd: workspace, env },
  );

  assert.notEqual(result.status, 0, 'should fail');
  assert.ok(
    result.stderr.includes('required for indexed') || result.stdout.includes('required for indexed'),
    `should mention "required for indexed", got:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  );
});

test('indexed rejects --business-canon skip', () => {
  const workspace = makeMultiRepoWorkspace(['svc1', 'svc2']);
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', 'skip', '--repos', 'svc1,svc2', '--mode', 'indexed'],
    { cwd: workspace, env },
  );

  assert.notEqual(result.status, 0, 'should fail');
  assert.ok(
    result.stderr.includes('required for indexed') || result.stdout.includes('required for indexed'),
    `should mention "required for indexed", got:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  );
});

test('indexed rejects --business-canon /local/path', () => {
  const workspace = makeMultiRepoWorkspace(['svc1', 'svc2']);
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', '/tmp/some-local-path', '--repos', 'svc1,svc2', '--mode', 'indexed'],
    { cwd: workspace, env },
  );

  assert.notEqual(result.status, 0, 'should fail');
  assert.ok(
    result.stderr.includes('not supported in indexed') || result.stdout.includes('not supported in indexed'),
    `should mention "not supported in indexed", got:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  );
});

test('indexed rejects mono-repo workspace', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  // Create .git at root — mono-repo layout
  fs.mkdirSync(path.join(workspace, '.git'), { recursive: true });

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', 'uxmaltech/collab-architecture', '--github-token', 'fake-token', '--mode', 'indexed'],
    { cwd: workspace, env },
  );

  assert.notEqual(result.status, 0, 'should fail for mono-repo in indexed mode');
  assert.ok(
    result.stderr.includes('mono-repo') || result.stdout.includes('mono-repo'),
    `should mention mono-repo restriction, got:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  );
});

test('indexed --yes without --business-canon fails', () => {
  const workspace = makeMultiRepoWorkspace(['svc1', 'svc2']);
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--repos', 'svc1,svc2', '--mode', 'indexed'],
    { cwd: workspace, env },
  );

  assert.notEqual(result.status, 0, 'should fail without --business-canon');
  assert.ok(
    result.stderr.includes('business-canon') || result.stdout.includes('business-canon'),
    `should mention business-canon requirement, got:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  );
});

test('indexed with GitHub canon passes parsing (dry-run)', () => {
  const workspace = makeMultiRepoWorkspace(['svc1', 'svc2']);
  const env = createFakeDockerEnv();

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

  assert.equal(result.status, 0, `should succeed with GitHub canon, got:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
});

test('file-only with --business-canon none still works (regression guard)', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', 'none', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `file-only + none should succeed, got:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
});
