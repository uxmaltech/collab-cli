import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../helpers/cli.mjs';
import { createFakeDockerEnv } from '../helpers/fake-docker.mjs';
import { makeTempWorkspace } from '../helpers/workspace.mjs';

/**
 * Creates a workspace with an existing .collab/config.json in the given mode.
 */
function makeWorkspaceWithConfig(mode) {
  const workspace = makeTempWorkspace();
  const collabDir = path.join(workspace, '.collab');
  fs.mkdirSync(collabDir, { recursive: true });
  fs.writeFileSync(
    path.join(collabDir, 'config.json'),
    JSON.stringify({ mode }, null, 2),
  );
  return workspace;
}

test('init infra runs only infrastructure stages (dry-run)', () => {
  const workspace = makeWorkspaceWithConfig('indexed');
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', 'infra'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  // Should have infra stages
  assert.ok(result.stdout.includes('Generate and validate compose files'), 'should have compose-generation');
  assert.ok(result.stdout.includes('Start infrastructure services'), 'should have infra-start');
  assert.ok(result.stdout.includes('Start MCP service'), 'should have mcp-start');
  assert.ok(result.stdout.includes('Generate MCP client config snippets'), 'should have mcp-client-config');
  assert.ok(result.stdout.includes('Seed NebulaGraph'), 'should have graph-seed');
  assert.ok(result.stdout.includes('Ingest canonical architecture'), 'should have canon-ingest');

  // Should NOT have wizard/setup stages
  assert.ok(!result.stdout.includes('Run preflight checks'), 'should not have preflight');
  assert.ok(!result.stdout.includes('Write local collab configuration'), 'should not have env-setup');
  assert.ok(!result.stdout.includes('Generate project architecture scaffold'), 'should not have repo-scaffold');

  // Summary should indicate infra only
  assert.ok(result.stdout.includes('infra only'), 'summary should show infra-only phase');
});

test('init infra bootstraps config on fresh host (dry-run)', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  // No .collab/config.json exists — init infra should bootstrap it
  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', 'infra'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  // Should still have all infra stages
  assert.ok(result.stdout.includes('Generate and validate compose files'), 'should have compose-generation');
  assert.ok(result.stdout.includes('Start infrastructure services'), 'should have infra-start');
  assert.ok(result.stdout.includes('Start MCP service'), 'should have mcp-start');

  // Summary indicates infra only
  assert.ok(result.stdout.includes('infra only'), 'summary should show infra-only phase');
});

test('init infra with existing file-only config overrides to indexed (dry-run)', () => {
  const workspace = makeWorkspaceWithConfig('file-only');
  const env = createFakeDockerEnv();

  // Even if config says file-only, init infra forces indexed
  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', 'infra'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('Start infrastructure services'), 'should run infra stages');
  assert.ok(result.stdout.includes('infra only'), 'summary should show infra-only phase');
});

test('init with unknown phase fails with helpful error', () => {
  const workspace = makeWorkspaceWithConfig('indexed');
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', 'foobar'],
    { cwd: workspace, env },
  );

  assert.notEqual(result.status, 0, 'should fail for unknown phase');
  assert.ok(
    result.stderr.includes('Unknown init phase'),
    'should report unknown phase',
  );
  assert.ok(
    result.stderr.includes('infra'),
    'should list available phases',
  );
});
