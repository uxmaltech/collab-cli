import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../helpers/cli.mjs';
import { createFakeDockerEnv } from '../helpers/fake-docker.mjs';
import { makeTempWorkspace } from '../helpers/workspace.mjs';

test('ci-setup generates both workflows in indexed mode (dry-run)', () => {
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
    result.stdout.includes('write architecture PR validation workflow'),
    'should mention PR workflow in dry-run',
  );
  assert.ok(
    result.stdout.includes('write architecture merge ingestion workflow'),
    'should mention merge workflow in dry-run for indexed mode',
  );
  assert.ok(
    result.stdout.includes('write AST delta PR extraction workflow'),
    'should mention AST delta workflow in dry-run for indexed mode',
  );
});

test('ci-setup skips ast-delta-pr.yml in file-only mode (dry-run)', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', 'none', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
  assert.ok(
    !result.stdout.includes('write AST delta PR extraction workflow'),
    'should NOT generate ast-delta workflow in file-only mode',
  );
});

test('ci-setup skips ast-delta-pr.yml with --skip-ast-delta (dry-run)', () => {
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
      '--skip-ast-delta',
    ],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
  assert.ok(
    !result.stdout.includes('write AST delta PR extraction workflow'),
    'should NOT generate ast-delta workflow when --skip-ast-delta is set',
  );
  // Other CI workflows should still be generated
  assert.ok(
    result.stdout.includes('write architecture PR validation workflow'),
    'should still generate PR workflow',
  );
});

test('ci-setup skips with --skip-ci flag (dry-run)', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', 'none', '--mode', 'file-only', '--skip-ci'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('Skipping CI workflow generation by user choice'),
    'should skip CI setup when --skip-ci is set',
  );
});

test('ci-setup stage appears in file-only output (dry-run)', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', 'none', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('Generate CI workflow files for architecture'),
    'ci-setup stage should appear in output',
  );
});
