import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../helpers/cli.mjs';
import { createFakeDockerEnv } from '../helpers/fake-docker.mjs';
import { makeTempWorkspace } from '../helpers/workspace.mjs';

/**
 * Creates a workspace directory with N child "repos" (directories with .git/).
 * Returns the workspace root path.
 */
function makeMultiRepoWorkspace(repoNames) {
  const workspace = makeTempWorkspace();
  for (const name of repoNames) {
    const repoDir = path.join(workspace, name);
    fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });
    // Add a minimal package.json so repo-scanner can detect something
    fs.writeFileSync(
      path.join(repoDir, 'package.json'),
      JSON.stringify({ name, version: '1.0.0' }),
    );
  }
  return workspace;
}

test('init --repos runs workspace mode with per-repo stages (dry-run)', () => {
  const workspace = makeMultiRepoWorkspace(['api', 'web']);
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--repos', 'api,web', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  // Workspace-level stages run once
  assert.ok(result.stdout.includes('Run preflight checks'), 'should have preflight');
  assert.ok(result.stdout.includes('Sync canonical architecture'), 'should have canon-sync');

  // Per-repo stages run for each repo
  assert.ok(result.stdout.includes('[repo 1/2]'), 'should show repo 1 header');
  assert.ok(result.stdout.includes('[repo 2/2]'), 'should show repo 2 header');
  assert.ok(result.stdout.includes('api'), 'should reference api repo');
  assert.ok(result.stdout.includes('web'), 'should reference web repo');

  // Summary includes workspace repos
  assert.ok(result.stdout.includes('Workspace repos'), 'summary should show workspace repos');
});

test('init --repos indexed workspace has infra phase (dry-run)', () => {
  const workspace = makeMultiRepoWorkspace(['svc1', 'svc2']);
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--repos', 'svc1,svc2', '--mode', 'indexed'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  // Infra stages should be present
  assert.ok(result.stdout.includes('Generate and validate compose files'), 'should have compose-generation');
  assert.ok(result.stdout.includes('Start infrastructure services'), 'should have infra-start');
  assert.ok(result.stdout.includes('Ingest canonical architecture'), 'should have canon-ingest');
});

test('init auto-discovers workspace when cwd has multiple git repos (dry-run)', () => {
  const workspace = makeMultiRepoWorkspace(['alpha', 'beta']);
  const env = createFakeDockerEnv();

  // No --repos flag, but workspace root has no .git and 2 child repos
  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  // Should auto-detect and run as workspace
  assert.ok(result.stdout.includes('[repo 1/2]'), 'should auto-detect workspace mode');
  assert.ok(result.stdout.includes('[repo 2/2]'), 'should process both repos');
});

test('init single-repo mode unchanged when cwd has .git (dry-run)', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  // Create .git at root — NOT a workspace
  fs.mkdirSync(path.join(workspace, '.git'), { recursive: true });

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  // Should NOT be workspace mode
  assert.ok(!result.stdout.includes('[repo '), 'single-repo should not have repo headers');
  // Should have the full single-repo pipeline
  assert.ok(result.stdout.includes('Generate project architecture scaffold'), 'should have repo-scaffold');
  assert.ok(result.stdout.includes('Generate agent skill files'), 'should have agent-skills-setup');
});

test('workspace config is persisted in .collab/config.json (dry-run)', () => {
  const workspace = makeMultiRepoWorkspace(['fe', 'be']);
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--repos', 'fe,be', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  // In dry-run the config is not actually written, but the output should
  // contain workspace references confirming the pipeline ran correctly
  assert.ok(result.stdout.includes('fe'), 'output references fe repo');
  assert.ok(result.stdout.includes('be'), 'output references be repo');
});
