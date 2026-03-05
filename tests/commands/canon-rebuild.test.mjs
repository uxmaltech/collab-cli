import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../helpers/cli.mjs';
import { makeTempWorkspace } from '../helpers/workspace.mjs';

/**
 * Helper to write a .collab/config.json with the given mode.
 */
function writeConfig(workspace, mode = 'file-only') {
  const collabDir = path.join(workspace, '.collab');
  fs.mkdirSync(collabDir, { recursive: true });
  const config = { mode };
  fs.writeFileSync(path.join(collabDir, 'config.json'), JSON.stringify(config));
}

// ────────────────────────────────────────────────────────────────
// Help & basic CLI
// ────────────────────────────────────────────────────────────────

test('canon command shows help with subcommands', () => {
  const result = runCli(['canon', '--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('rebuild'), 'should list rebuild subcommand');
});

test('canon rebuild --help shows description and flags', () => {
  const result = runCli(['canon', 'rebuild', '--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('--confirm'), 'should show --confirm flag');
  assert.ok(result.stdout.includes('--graph'), 'should show --graph flag');
  assert.ok(result.stdout.includes('--vectors'), 'should show --vectors flag');
  assert.ok(result.stdout.includes('--indexes'), 'should show --indexes flag');
});

// ────────────────────────────────────────────────────────────────
// Safety: --confirm required
// ────────────────────────────────────────────────────────────────

test('canon rebuild fails without --confirm', () => {
  const workspace = makeTempWorkspace();
  writeConfig(workspace, 'file-only');

  const result = runCli(['--cwd', workspace, 'canon', 'rebuild'], {
    cwd: workspace,
  });

  assert.notEqual(result.status, 0, 'should fail without --confirm');
  assert.ok(
    result.stderr.includes('--confirm') || result.stderr.includes('destructive'),
    'error should mention --confirm',
  );
});

test('canon rebuild dry-run works without --confirm', () => {
  const workspace = makeTempWorkspace();
  writeConfig(workspace, 'file-only');

  const result = runCli(['--cwd', workspace, '--dry-run', 'canon', 'rebuild'], {
    cwd: workspace,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('dry-run'), 'should show dry-run output');
});

// ────────────────────────────────────────────────────────────────
// Mode-aware validation
// ────────────────────────────────────────────────────────────────

test('canon rebuild --graph fails in file-only mode', () => {
  const workspace = makeTempWorkspace();
  writeConfig(workspace, 'file-only');

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'canon', 'rebuild', '--confirm', '--graph'],
    { cwd: workspace },
  );

  assert.notEqual(result.status, 0, 'should fail with --graph in file-only mode');
  assert.ok(
    result.stderr.includes('indexed') || result.stderr.includes('file-only'),
    'error should mention indexed mode',
  );
});

test('canon rebuild --vectors fails in file-only mode', () => {
  const workspace = makeTempWorkspace();
  writeConfig(workspace, 'file-only');

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'canon', 'rebuild', '--confirm', '--vectors'],
    { cwd: workspace },
  );

  assert.notEqual(result.status, 0, 'should fail with --vectors in file-only mode');
  assert.ok(
    result.stderr.includes('indexed') || result.stderr.includes('file-only'),
    'error should mention indexed mode',
  );
});

// ────────────────────────────────────────────────────────────────
// file-only mode: --indexes works
// ────────────────────────────────────────────────────────────────

test('canon rebuild --indexes works in file-only mode (dry-run)', () => {
  const workspace = makeTempWorkspace();
  writeConfig(workspace, 'file-only');

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'canon', 'rebuild', '--confirm', '--indexes'],
    { cwd: workspace },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    result.stdout.includes('index') || result.stdout.includes('Regenerate'),
    'should show index rebuild stage',
  );
});

// ────────────────────────────────────────────────────────────────
// Full rebuild dry-run
// ────────────────────────────────────────────────────────────────

test('canon rebuild full dry-run in file-only mode shows 3 stages', () => {
  const workspace = makeTempWorkspace();
  writeConfig(workspace, 'file-only');

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'canon', 'rebuild', '--confirm'],
    { cwd: workspace },
  );

  assert.equal(result.status, 0, result.stderr);
  // file-only full = snapshot + indexes + validate (no graph, no vectors)
  assert.ok(result.stdout.includes('snapshot') || result.stdout.includes('Snapshot'));
  assert.ok(result.stdout.includes('index') || result.stdout.includes('Regenerate'));
  assert.ok(result.stdout.includes('Validate') || result.stdout.includes('validate'));
  // graph and vectors should NOT appear
  assert.ok(!result.stdout.includes('NebulaGraph'));
  assert.ok(!result.stdout.includes('Qdrant'));
});

test('canon rebuild full dry-run in indexed mode shows all 5 stages', () => {
  const workspace = makeTempWorkspace();
  writeConfig(workspace, 'indexed');

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'canon', 'rebuild', '--confirm'],
    { cwd: workspace },
  );

  assert.equal(result.status, 0, result.stderr);
  // indexed full = snapshot + indexes + graph + vectors + validate
  assert.ok(result.stdout.includes('snapshot') || result.stdout.includes('Snapshot'));
  assert.ok(result.stdout.includes('index') || result.stdout.includes('Regenerate'));
  assert.ok(result.stdout.includes('NebulaGraph') || result.stdout.includes('graph'));
  assert.ok(result.stdout.includes('vector') || result.stdout.includes('Qdrant'));
  assert.ok(result.stdout.includes('Validate') || result.stdout.includes('validate'));
});

// ────────────────────────────────────────────────────────────────
// Selective rebuild
// ────────────────────────────────────────────────────────────────

test('canon rebuild --indexes only runs index stage (dry-run)', () => {
  const workspace = makeTempWorkspace();
  writeConfig(workspace, 'indexed');

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'canon', 'rebuild', '--confirm', '--indexes'],
    { cwd: workspace },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('index') || result.stdout.includes('Regenerate'));
  // graph and vectors should NOT appear
  assert.ok(!result.stdout.includes('NebulaGraph'));
  assert.ok(!result.stdout.includes('Qdrant'));
});
