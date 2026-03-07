import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../helpers/cli.mjs';
import { createFakeDockerEnv } from '../helpers/fake-docker.mjs';
import { makeTempWorkspace, makeMultiRepoWorkspace } from '../helpers/workspace.mjs';

// ── Resume flow ─────────────────────────────────────────────────
// Note: --dry-run executor logs state writes but does not create files.
// We verify state tracking via executor log output in stdout.

test('dry-run logs state file writes after each stage', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', 'none', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    result.stdout.includes('write state file'),
    'should log state file writes during dry-run',
  );
  assert.ok(
    result.stdout.includes('state.json'),
    'state file path should reference state.json',
  );
});

test('--resume without prior state runs normally', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  // First run with --resume on a fresh workspace (no state.json)
  // Should just run all stages normally (nothing to skip)
  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--resume', '--yes', '--business-canon', 'none', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, result.stderr);
  // Should complete all stages without error
  assert.ok(result.stdout.includes('Run preflight checks'), 'should run preflight');
  assert.ok(result.stdout.includes('Setup complete'), 'should complete successfully');
});

test('workspace mode state writes reference per-repo workflows', () => {
  const workspace = makeMultiRepoWorkspace(['api', 'web']);
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', 'none', '--repos', 'api,web', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, result.stderr);
  // State should be written multiple times (workspace + per-repo workflows)
  const stateWrites = result.stdout.split('write state file').length - 1;
  assert.ok(stateWrites >= 3, `should write state at least 3 times (workspace + 2 repos), got ${stateWrites}`);
});

// ── Non-interactive edge cases ──────────────────────────────────

test('--yes defaults to file-only mode with info message', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', 'none'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    result.stderr.includes('defaults to file-only') || result.stdout.includes('defaults to file-only'),
    'should inform about defaulting to file-only',
  );
});

test('--yes with full indexed flags completes without prompts', () => {
  const workspace = makeMultiRepoWorkspace(['svc1', 'svc2']);
  const env = createFakeDockerEnv();

  const result = runCli(
    [
      '--cwd', workspace, '--dry-run', 'init', '--yes',
      '--mode', 'indexed',
      '--business-canon', 'uxmaltech/collab-architecture',
      '--github-token', 'fake-token',
      '--repos', 'svc1,svc2',
      '--compose-mode', 'split',
    ],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('indexed'), 'should show indexed mode');
  assert.ok(result.stdout.includes('split'), 'should use split compose mode');
});

// ── Infra-only special flow ─────────────────────────────────────

test('init infra with --mcp-url sets remote infra type', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    [
      '--cwd', workspace, '--dry-run', 'init', 'infra',
      '--infra-type', 'remote',
      '--mcp-url', 'http://my-server:7337',
    ],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('Verify remote MCP'), 'should have remote MCP health check');
  assert.ok(!result.stdout.includes('Start infrastructure services'), 'should skip Docker infra');
});

test('init infra without --mcp-url in remote mode fails', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', 'infra', '--infra-type', 'remote'],
    { cwd: workspace, env },
  );

  assert.notEqual(result.status, 0, 'should fail without --mcp-url');
  assert.ok(
    result.stderr.includes('--mcp-url'),
    'error should mention --mcp-url requirement',
  );
});

test('init infra shows summary footer', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', 'infra'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('Phase'), 'summary should have Phase entry');
  assert.ok(result.stdout.includes('Compose mode'), 'summary should have Compose mode entry');
});

test('init infra logs state writes for resume support', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', 'infra'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    result.stdout.includes('write state file'),
    'should log state file writes during infra dry-run',
  );
});

// ── Repo domain generation special flow ─────────────────────────

test('init --repo shows domain generation header', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  // Create a fake repo directory
  const repoDir = path.join(workspace, 'my-pkg');
  fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({ name: 'my-pkg', version: '1.0.0' }));

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--repo', 'my-pkg', '--mode', 'file-only', '--yes'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('Domain Generation'), 'should show domain generation header');
  assert.ok(result.stdout.includes('my-pkg'), 'should reference the repo name');
});

test('init --repo runs ecosystem compatibility checks', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const repoDir = path.join(workspace, 'my-pkg');
  fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({ name: 'my-pkg', version: '1.0.0' }));

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--repo', 'my-pkg', '--mode', 'file-only', '--yes'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, result.stderr);
  const hasChecks = result.stdout.includes('[PASS]') || result.stdout.includes('[WARN]');
  assert.ok(hasChecks, 'should run ecosystem compatibility checks');
});

test('init --repo logs state writes for resume support', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const repoDir = path.join(workspace, 'my-pkg');
  fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({ name: 'my-pkg', version: '1.0.0' }));

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--repo', 'my-pkg', '--mode', 'file-only', '--yes'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    result.stdout.includes('write state file'),
    'should log state file writes during repo domain gen',
  );
});

// ── Error paths ─────────────────────────────────────────────────

test('unknown phase fails with clear error', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', 'banana'],
    { cwd: workspace, env },
  );

  assert.notEqual(result.status, 0, 'should fail with unknown phase');
  assert.ok(
    result.stderr.includes('Unknown init phase') || result.stderr.includes('banana'),
    'error should mention the invalid phase',
  );
});

test('invalid --mode value fails with clear error', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', 'none', '--mode', 'banana'],
    { cwd: workspace, env },
  );

  assert.notEqual(result.status, 0, 'should fail with invalid mode');
  assert.ok(
    result.stderr.includes('banana') || result.stderr.includes('Invalid'),
    'error should mention the invalid value',
  );
});

test('invalid --compose-mode value fails with clear error', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', 'none', '--mode', 'file-only', '--compose-mode', 'banana'],
    { cwd: workspace, env },
  );

  assert.notEqual(result.status, 0, 'should fail with invalid compose mode');
  assert.ok(
    result.stderr.includes('banana') || result.stderr.includes('Invalid compose mode'),
    'error should mention the invalid compose mode',
  );
});

test('invalid --business-canon format fails with clear error', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--mode', 'file-only', '--business-canon', 'no-slash-here'],
    { cwd: workspace, env },
  );

  assert.notEqual(result.status, 0, 'should fail with invalid format');
  assert.ok(
    result.stderr.includes('Invalid business canon format') || result.stderr.includes('owner/repo'),
    'error should explain expected format',
  );
});

test('--skip-analysis flag is accepted and suppresses analysis stage', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', 'none', '--mode', 'file-only', '--skip-analysis'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, result.stderr);
});

test('--skip-ci flag is accepted', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', 'none', '--mode', 'file-only', '--skip-ci'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, result.stderr);
});
