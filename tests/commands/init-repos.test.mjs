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

// ── Single-repo via subcommand ──────────────────────────────────

test('init repos <single-path> shows domain generation in dry-run', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();
  const pkgDir = createFakePackage(workspace, 'my-pkg');

  const result = runCli(
    [
      '--cwd', workspace,
      '--dry-run',
      'init', 'repos', pkgDir,
      '--mode', 'file-only',
      '--yes',
      '--business-canon', 'none',
    ],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('Domain Generation'), 'should show Domain Generation header');
  assert.ok(result.stdout.includes('file-only'), 'should show file-only mode');
});

// ── Multi-repo ──────────────────────────────────────────────────

test('init repos <multiple-paths> runs sequentially and shows repo headers', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();
  const pkg1 = createFakePackage(workspace, 'pkg-a');
  const pkg2 = createFakePackage(workspace, 'pkg-b');

  const result = runCli(
    [
      '--cwd', workspace,
      '--dry-run',
      'init', 'repos', pkg1, pkg2,
      '--mode', 'file-only',
      '--yes',
      '--business-canon', 'none',
    ],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('[repo 1/2]'), 'should show repo 1 of 2');
  assert.ok(result.stdout.includes('[repo 2/2]'), 'should show repo 2 of 2');
  assert.ok(result.stdout.includes('pkg-a'), 'should include first repo name');
  assert.ok(result.stdout.includes('pkg-b'), 'should include second repo name');
});

test('init repos multi-repo shows aggregate summary', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();
  const pkg1 = createFakePackage(workspace, 'pkg-a');
  const pkg2 = createFakePackage(workspace, 'pkg-b');

  const result = runCli(
    [
      '--cwd', workspace,
      '--dry-run',
      'init', 'repos', pkg1, pkg2,
      '--mode', 'file-only',
      '--yes',
      '--business-canon', 'none',
    ],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('Domain Generation Complete'),
    'should show aggregate completion header',
  );
  assert.ok(result.stdout.includes('Total repos'), 'should show total repos in summary');
  assert.ok(result.stdout.includes('Succeeded'), 'should show succeeded count');
});

// ── Error handling ──────────────────────────────────────────────

test('init repos with nonexistent path warns but continues to valid repos', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();
  const goodPkg = createFakePackage(workspace, 'good-pkg');

  const result = runCli(
    [
      '--cwd', workspace,
      '--dry-run',
      'init', 'repos', 'nonexistent-xyz', goodPkg,
      '--mode', 'file-only',
      '--yes',
      '--business-canon', 'none',
    ],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('Failed') || result.stderr.includes('not found'),
    'should indicate failure for nonexistent repo',
  );
  assert.ok(result.stdout.includes('good-pkg'), 'should process the valid repo');
});

// ── Flags inheritance ───────────────────────────────────────────

test('init repos passes --skip-ingest to underlying pipeline', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();
  const pkgDir = createFakePackage(workspace, 'my-pkg');

  const result = runCli(
    [
      '--cwd', workspace,
      '--dry-run',
      'init', 'repos', pkgDir,
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

// ── Backward compat: --repo shows deprecation warning ───────────

test('init --repo shows deprecation warning', () => {
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
    result.stdout.includes('deprecated') || result.stderr.includes('deprecated'),
    'should show deprecation warning for --repo flag',
  );
  assert.ok(result.stdout.includes('Domain Generation'), 'should still run domain generation');
});
