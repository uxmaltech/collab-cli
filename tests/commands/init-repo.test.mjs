import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../helpers/cli.mjs';
import { createFakeDockerEnv } from '../helpers/fake-docker.mjs';
import { makeTempWorkspace } from '../helpers/workspace.mjs';

/**
 * Creates a minimal fake package inside the workspace.
 */
function createFakePackage(workspace, name) {
  const pkgDir = path.join(workspace, name);
  fs.mkdirSync(path.join(pkgDir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name, dependencies: { express: '^4.0.0' } }),
  );
  fs.writeFileSync(path.join(pkgDir, 'src', 'index.ts'), 'console.log("hello");');
  return pkgDir;
}

test('init --repo shows domain generation and ingest stages in dry-run (file-only)', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();
  const pkgDir = createFakePackage(workspace, 'my-pkg');

  const result = runCli(
    [
      '--cwd', workspace,
      '--dry-run',
      'init',
      '--repo', pkgDir,
      '--mode', 'file-only',
      '--yes',
      '--business-canon', 'none',
    ],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('Domain Generation'), 'should show Domain Generation header');
  assert.ok(result.stdout.includes('file-only'), 'should show file-only mode');
  assert.ok(
    result.stdout.includes('Analyze repository') || result.stdout.includes('domain-analysis'),
    'should have domain analysis stage',
  );
  assert.ok(
    result.stdout.includes('[3/3]') || result.stdout.includes('Extract AST'),
    'should include the AST ingest stage as stage 3',
  );
});

test('init --repo shows indexed stages in dry-run', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();
  const pkgDir = createFakePackage(workspace, 'my-pkg');

  const result = runCli(
    [
      '--cwd', workspace,
      '--dry-run',
      'init',
      '--repo', pkgDir,
      '--mode', 'indexed',
      '--yes',
      '--business-canon', 'uxmaltech/collab-architecture',
    ],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('Domain Generation'), 'should show Domain Generation header');
  assert.ok(
    result.stdout.includes('Sync business canon') || result.stdout.includes('domain-canon-sync'),
    'should have canon sync stage',
  );
  assert.ok(
    result.stdout.includes('Extract AST'),
    'should include the AST ingest stage in indexed mode',
  );
});

test('init --repo fails with nonexistent package', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    [
      '--cwd', workspace,
      '--dry-run',
      'init',
      '--repo', 'nonexistent-pkg-xyz',
      '--mode', 'file-only',
      '--yes',
      '--business-canon', 'none',
    ],
    { cwd: workspace, env },
  );

  assert.notEqual(result.status, 0, 'should fail for nonexistent package');
  assert.ok(
    result.stderr.includes('not found') || result.stdout.includes('not found'),
    'should mention package not found',
  );
});

test('init --repo --skip-ingest omits AST ingest stage', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();
  const pkgDir = createFakePackage(workspace, 'my-pkg');

  const result = runCli(
    [
      '--cwd', workspace,
      '--dry-run',
      'init',
      '--repo', pkgDir,
      '--mode', 'file-only',
      '--yes',
      '--business-canon', 'none',
      '--skip-ingest',
    ],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('[1/2]') && result.stdout.includes('[2/2]'),
    'should show only 2 stages when --skip-ingest is used',
  );
  assert.ok(
    !result.stdout.includes('Extract AST'),
    'should NOT include AST ingest stage',
  );
});

test('init --repo dry-run shows AST extraction stats', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();
  const pkgDir = createFakePackage(workspace, 'my-pkg');

  const result = runCli(
    [
      '--cwd', workspace,
      '--dry-run',
      'init',
      '--repo', pkgDir,
      '--mode', 'file-only',
      '--yes',
      '--business-canon', 'none',
    ],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('AST extraction complete') || result.stdout.includes('nodes'),
    'should show AST extraction stats in dry-run',
  );
  assert.ok(
    result.stdout.includes('source file'),
    'should mention source files found',
  );
});

test('init --repo indexed without business-canon fails', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();
  const pkgDir = createFakePackage(workspace, 'my-pkg');

  const result = runCli(
    [
      '--cwd', workspace,
      '--dry-run',
      'init',
      '--repo', pkgDir,
      '--mode', 'indexed',
      '--yes',
      '--business-canon', 'none',
    ],
    { cwd: workspace, env },
  );

  assert.notEqual(result.status, 0, 'should fail without business canon in indexed mode');
  assert.ok(
    result.stderr.includes('Business canon') || result.stdout.includes('Business canon'),
    'should mention business canon requirement',
  );
});
