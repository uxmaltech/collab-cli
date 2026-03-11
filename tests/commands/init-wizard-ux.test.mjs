import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../helpers/cli.mjs';
import { createFakeDockerEnv } from '../helpers/fake-docker.mjs';
import { makeTempWorkspace, makeMultiRepoWorkspace } from '../helpers/workspace.mjs';

// ── Wizard intro / outro ───────────────────────────────────────

test('wizard shows intro banner with version', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', 'none', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('collab init v'), 'should show wizard intro with version');
});

test('wizard shows "Setup complete" outro on success', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', 'none', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('Setup complete'), 'should show wizard outro');
});

test('wizard does not show outro on failure', () => {
  const workspace = makeMultiRepoWorkspace(['svc1', 'svc2']);
  const env = createFakeDockerEnv();

  // Missing --business-canon in indexed --yes mode → fails
  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--repos', 'svc1,svc2', '--mode', 'indexed'],
    { cwd: workspace, env },
  );

  assert.notEqual(result.status, 0, 'should fail');
  assert.ok(!result.stdout.includes('Setup complete'), 'should NOT show outro on failure');
});

// ── Wizard step progression ─────────────────────────────────────

test('file-only empty workspace wizard shows steps in correct order', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  // Empty workspace + --yes → auto-detects as mono-repo with repos=['.']
  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', 'none', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, result.stderr);

  const out = result.stdout;
  const idxConfig = out.indexOf('Configuration');
  const idxCanon = out.indexOf('Business Canon');
  const idxWorkspace = out.indexOf('Workspace Setup');

  assert.ok(idxConfig >= 0, 'should have Configuration step');
  assert.ok(idxCanon >= 0, 'should have Business Canon step');
  assert.ok(idxWorkspace >= 0, 'should have Workspace Setup step');
  assert.ok(idxConfig < idxCanon, 'Configuration before Business Canon');
  assert.ok(idxCanon < idxWorkspace, 'Business Canon before Workspace Setup');
});

test('file-only workspace wizard shows steps in correct order', () => {
  const workspace = makeMultiRepoWorkspace(['api', 'web']);
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', 'none', '--repos', 'api,web', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, result.stderr);

  const out = result.stdout;
  const idxConfig = out.indexOf('Configuration');
  const idxWorkspace = out.indexOf('Workspace Setup');
  const idxRepo = out.indexOf('Repository Setup');

  assert.ok(idxConfig >= 0, 'should have Configuration step');
  assert.ok(idxWorkspace >= 0, 'should have Workspace Setup step');
  assert.ok(idxRepo >= 0, 'should have Repository Setup step');
  assert.ok(idxConfig < idxWorkspace, 'Configuration should come before Workspace Setup');
  assert.ok(idxWorkspace < idxRepo, 'Workspace Setup should come before Repository Setup');

  assert.ok(out.includes('2 repositories'), 'should show repo count');
  assert.ok(out.includes('multi-repo'), 'should show workspace type');
});

test('indexed workspace wizard shows all phases in correct order', () => {
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

  assert.equal(result.status, 0, result.stderr);

  const out = result.stdout;
  const idxConfig = out.indexOf('Configuration');
  const idxCanon = out.indexOf('Business Canon');
  const idxWorkspace = out.indexOf('Workspace Setup');
  const idxRepo = out.indexOf('Repository Setup');
  // Use the step-specific banner pattern to avoid matching the summary footer
  // (wizardStep output: "Step N · Infrastructure", footer: "Infrastructure: value")
  const infraStepMatch = out.match(/Step \d+.*Infrastructure/);
  assert.ok(infraStepMatch, 'should have Infrastructure wizard step');
  const idxInfra = infraStepMatch.index;

  assert.ok(idxConfig >= 0, 'should have Configuration step');
  assert.ok(idxCanon >= 0, 'should have Business Canon step');
  assert.ok(idxWorkspace >= 0, 'should have Workspace Setup step');
  assert.ok(idxRepo >= 0, 'should have Repository Setup step');

  // Verify correct ordering
  assert.ok(idxConfig < idxCanon, 'Configuration before Business Canon');
  assert.ok(idxCanon < idxWorkspace, 'Business Canon before Workspace Setup');
  assert.ok(idxWorkspace < idxRepo, 'Workspace Setup before Repository Setup');
  assert.ok(idxRepo < idxInfra, 'Repository Setup before Infrastructure');
});

// ── Summary footer ──────────────────────────────────────────────

test('summary footer shows mode and config path', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', 'none', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('Mode'), 'summary should have Mode entry');
  assert.ok(result.stdout.includes('file-only'), 'summary should show file-only');
  assert.ok(result.stdout.includes('Config'), 'summary should have Config entry');
  assert.ok(result.stdout.includes('config.json'), 'summary should reference config file');
});

test('indexed summary shows infrastructure and compose mode', () => {
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

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('Infrastructure'), 'summary should have Infrastructure entry');
  assert.ok(result.stdout.includes('Compose mode'), 'summary should have Compose mode entry');
});

// ── Config preservation ─────────────────────────────────────────

test('existing config is preserved without --force (skips Business Canon step)', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  // First run: create the config
  const collabDir = path.join(workspace, '.collab');
  fs.mkdirSync(collabDir, { recursive: true });
  fs.writeFileSync(
    path.join(collabDir, 'config.json'),
    JSON.stringify({
      mode: 'file-only',
      workspace: { name: 'test', type: 'mono-repo', repos: ['.'] },
    }),
  );

  // Second run: should preserve existing config
  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', 'none', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    result.stdout.includes('Existing configuration detected'),
    'should inform about config preservation',
  );
  // Business Canon step should be SKIPPED (preserveExisting = true)
  assert.ok(
    !result.stdout.includes('Business Canon'),
    'should skip Business Canon step when preserving config',
  );
});

test('--force overrides existing config and runs Business Canon step', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  // Create existing config
  const collabDir = path.join(workspace, '.collab');
  fs.mkdirSync(collabDir, { recursive: true });
  fs.writeFileSync(
    path.join(collabDir, 'config.json'),
    JSON.stringify({
      mode: 'file-only',
      workspace: { name: 'test', type: 'mono-repo', repos: ['.'] },
    }),
  );

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--force', '--business-canon', 'none', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, result.stderr);
  // logger.warn writes to stderr
  assert.ok(
    result.stderr.includes('Force mode enabled'),
    'should show force warning on stderr',
  );

  // Verify the wizard actually re-ran the Business Canon step
  // (without --force, this step is skipped when config exists)
  assert.ok(
    !result.stdout.includes('Existing configuration detected'),
    'should NOT show config preservation message with --force',
  );

  // The config-write stage should re-execute (not skip)
  assert.ok(
    result.stdout.includes('Write local collab configuration'),
    'should re-run config-write stage with --force',
  );
});

// ── Error messages with recovery instructions ───────────────────

test('indexed --yes without --business-canon includes recovery hint', () => {
  const workspace = makeMultiRepoWorkspace(['svc1', 'svc2']);
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--repos', 'svc1,svc2', '--mode', 'indexed'],
    { cwd: workspace, env },
  );

  assert.notEqual(result.status, 0, 'should fail');
  assert.ok(
    result.stderr.includes('--business-canon owner/repo'),
    'error should include recovery flag hint',
  );
});

test('indexed mono-repo error includes actionable guidance', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  fs.mkdirSync(path.join(workspace, '.git'), { recursive: true });

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', 'uxmaltech/collab-architecture', '--github-token', 'fake', '--mode', 'indexed'],
    { cwd: workspace, env },
  );

  assert.notEqual(result.status, 0, 'should fail for mono-repo in indexed mode');
  assert.ok(
    result.stderr.includes('Run from a parent directory'),
    'error should include actionable guidance',
  );
});

test('indexed --yes with no repos and no workspace includes recovery hints', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', 'uxmaltech/collab-architecture', '--github-token', 'fake', '--mode', 'indexed'],
    { cwd: workspace, env },
  );

  assert.notEqual(result.status, 0, 'should fail');
  assert.ok(
    result.stderr.includes('--repos') || result.stderr.includes('Clone your repos'),
    'error should suggest --repos flag or clone action',
  );
});

test('--yes without --business-canon in file-only mode defaults to skip', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    result.stdout.includes('skipping business canon'),
    'should log that business canon was skipped',
  );
});

// ── Next steps guidance ─────────────────────────────────────────

test('file-only wizard shows upgrade hint in next steps', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', 'none', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('Next steps'), 'should show next steps');
  assert.ok(
    result.stdout.includes('collab init --mode indexed'),
    'file-only should suggest upgrade to indexed',
  );
  assert.ok(
    result.stdout.includes('collab doctor'),
    'should suggest running collab doctor',
  );
});

test('indexed wizard shows canon rebuild hint in next steps', () => {
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

  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    result.stdout.includes('collab canon rebuild'),
    'indexed should suggest canon rebuild',
  );
});

// ── Ecosystem compatibility checks ──────────────────────────────

test('wizard runs ecosystem compatibility checks at the end', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', 'none', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, result.stderr);
  // Ecosystem checks output [PASS] or [WARN] prefixes
  const hasChecks = result.stdout.includes('[PASS]') || result.stdout.includes('[WARN]');
  assert.ok(hasChecks, 'should run ecosystem compatibility checks');
});
