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
function makeWorkspaceWithConfig(mode, extras = {}) {
  const workspace = makeTempWorkspace();
  const collabDir = path.join(workspace, '.collab');
  fs.mkdirSync(collabDir, { recursive: true });
  fs.writeFileSync(
    path.join(collabDir, 'config.json'),
    JSON.stringify({ mode, ...extras }, null, 2),
  );
  return workspace;
}

test('init github-workflow runs GitHub workflow stages in dry-run (indexed)', () => {
  const workspace = makeWorkspaceWithConfig('indexed');
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', 'github-workflow'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  // Should have the three stages
  assert.ok(result.stdout.includes('Authorize GitHub access'), 'should have github-auth stage');
  assert.ok(
    result.stdout.includes('Configure GitHub branch model'),
    'should have github-setup stage',
  );
  assert.ok(result.stdout.includes('Generate CI workflow files'), 'should have ci-setup stage');

  // Should NOT have unrelated wizard stages
  assert.ok(!result.stdout.includes('Run preflight checks'), 'should not have preflight');
  assert.ok(!result.stdout.includes('Write local collab configuration'), 'should not have env-setup');
  assert.ok(!result.stdout.includes('Generate project architecture scaffold'), 'should not have repo-scaffold');

  // Summary footer
  assert.match(result.stdout, /Phase:\s*github-workflow/, 'summary should show github-workflow phase');
  assert.match(result.stdout, /Mode:\s*indexed/, 'summary should show indexed mode');
});

test('init github-workflow in file-only mode runs ci-setup (dry-run)', () => {
  const workspace = makeWorkspaceWithConfig('file-only');
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', 'github-workflow'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  // ci-setup should be present
  assert.ok(result.stdout.includes('Generate CI workflow files'), 'should have ci-setup stage');

  // Summary should show file-only mode
  assert.match(result.stdout, /Mode:\s*file-only/, 'summary should show file-only mode');
});

test('init github-workflow fails without .collab/config.json', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', 'github-workflow'],
    { cwd: workspace, env },
  );

  assert.notEqual(result.status, 0, 'should fail without config');
  assert.ok(
    result.stderr.includes('No .collab/config.json found') ||
      result.stderr.includes('collab init'),
    'should suggest running collab init first',
  );
});

test('init github-workflow respects --skip-github-setup', () => {
  const workspace = makeWorkspaceWithConfig('indexed');
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', 'github-workflow', '--skip-github-setup'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  // github-setup stage should be present but skipped
  assert.ok(
    result.stdout.includes('Configure GitHub branch model'),
    'github-setup stage should still appear in pipeline',
  );
});

test('init github-workflow respects --skip-ci', () => {
  const workspace = makeWorkspaceWithConfig('indexed');
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', 'github-workflow', '--skip-ci'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  // ci-setup stage should be present but skipped
  assert.ok(
    result.stdout.includes('Generate CI workflow files'),
    'ci-setup stage should still appear in pipeline',
  );
});

test('init --help lists github-workflow subcommand', () => {
  const result = runCli(['init', '--help']);

  assert.equal(result.status, 0);
  assert.ok(
    result.stdout.includes('github-workflow'),
    'help should list github-workflow subcommand',
  );
});
