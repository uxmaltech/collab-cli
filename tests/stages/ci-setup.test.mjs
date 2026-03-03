import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../helpers/cli.mjs';
import { createFakeDockerEnv } from '../helpers/fake-docker.mjs';
import { makeTempWorkspace } from '../helpers/workspace.mjs';

test('ci-setup generates PR workflow in file-only mode', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, 'init', '--yes', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);

  const prWorkflow = path.join(workspace, '.github', 'workflows', 'architecture-pr.yml');
  assert.ok(fs.existsSync(prWorkflow), 'PR workflow should be generated');

  const content = fs.readFileSync(prWorkflow, 'utf8');
  assert.ok(content.includes('Architecture Validation'), 'PR workflow should have correct name');
  assert.ok(content.includes('pull_request'), 'PR workflow should trigger on pull_request');

  // Merge workflow should NOT exist in file-only mode
  const mergeWorkflow = path.join(workspace, '.github', 'workflows', 'architecture-merge.yml');
  assert.ok(!fs.existsSync(mergeWorkflow), 'merge workflow should NOT exist in file-only mode');
});

test('ci-setup generates both workflows in indexed mode (dry-run)', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--mode', 'indexed'],
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
});

test('ci-setup does not overwrite existing workflows', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();
  const workflowDir = path.join(workspace, '.github', 'workflows');

  // Create an existing PR workflow with custom content
  fs.mkdirSync(workflowDir, { recursive: true });
  const customContent = '# My custom PR workflow\nname: Custom\n';
  fs.writeFileSync(path.join(workflowDir, 'architecture-pr.yml'), customContent);

  const result = runCli(
    ['--cwd', workspace, 'init', '--yes', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);

  // Existing workflow should NOT be overwritten
  const existing = fs.readFileSync(
    path.join(workflowDir, 'architecture-pr.yml'),
    'utf8',
  );
  assert.equal(existing, customContent, 'existing workflow should be preserved');
});

test('ci-setup skips with --skip-ci flag', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--mode', 'file-only', '--skip-ci'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('Skipping CI workflow generation by user choice'),
    'should skip CI setup when --skip-ci is set',
  );
});

test('ci-setup stage appears in output', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('Generate CI workflow files for architecture'),
    'ci-setup stage should appear in output',
  );
});
