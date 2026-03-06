import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../helpers/cli.mjs';
import { createFakeDockerEnv } from '../helpers/fake-docker.mjs';
import { makeTempWorkspace } from '../helpers/workspace.mjs';

test('init interactive flow prompts in expected order', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();
  // Inputs: 2=indexed, \n=default compose mode
  // Use --infra-type and --business-canon flags to limit interactive prompts to 2,
  // avoiding a Node.js limitation where ≥3 sequential readline interfaces on piped
  // stdin can hang (the pipe's readable state is not reliably restored after close).
  const input = '2\n\n';

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--infra-type', 'local', '--business-canon', 'none'],
    { cwd: workspace, env, input },
  );

  assert.equal(result.status, 0, result.stderr);

  const modePrompt = result.stdout.indexOf('Select setup mode:');
  const composePrompt = result.stdout.indexOf('Select compose generation mode:');

  assert.ok(modePrompt >= 0, 'mode prompt missing');
  assert.ok(composePrompt > modePrompt, 'compose prompt should come after mode');

  // Infra type prompt should NOT appear when --infra-type is passed via CLI flag
  assert.ok(
    !result.stdout.includes('Infrastructure type:'),
    'infra type prompt should be skipped when --infra-type flag is given',
  );
});

test('init --yes accepts explicit flags in non-interactive mode', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    [
      '--cwd',
      workspace,
      '--dry-run',
      'init',
      '--yes',
      '--business-canon', 'none',
      '--mode',
      'indexed',
      '--compose-mode',
      'split',
      '--skip-mcp-snippets',
    ],
    {
      cwd: workspace,
      env,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('indexed'), 'summary should show indexed mode');
  assert.match(result.stdout, /Skipping MCP snippet generation by user choice/i);
});

test('init --yes --mode file-only has no compose or MCP stages', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--business-canon', 'none', '--mode', 'file-only'],
    {
      cwd: workspace,
      env,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('file-only'), 'summary should show file-only mode');

  // File-only pipeline should NOT contain compose or MCP stages at all
  assert.ok(
    !result.stdout.includes('Generate and validate compose files'),
    'file-only should not have compose stage',
  );
  assert.ok(
    !result.stdout.includes('Generate MCP client config snippets'),
    'file-only should not have MCP config stage',
  );
});

test('init --yes --infra-type remote uses remote stages and skips Docker', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    [
      '--cwd', workspace, '--dry-run', 'init', '--yes',
      '--mode', 'indexed',
      '--infra-type', 'remote',
      '--mcp-url', 'http://my-server:7337',
      '--business-canon', 'none',
    ],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  // Remote should skip Docker stages
  assert.ok(!result.stdout.includes('Generate and validate compose files'), 'should skip compose-generation');
  assert.ok(!result.stdout.includes('Start infrastructure services'), 'should skip infra-start');
  assert.ok(!result.stdout.includes('Start MCP service'), 'should skip mcp-start');

  // Remote should have health check and MCP config
  assert.ok(result.stdout.includes('Verify remote MCP'), 'should have mcp-health-check');
  assert.ok(result.stdout.includes('Generate MCP client config snippets'), 'should have mcp-client-config');

  // Summary should indicate remote
  assert.ok(result.stdout.includes('remote'), 'summary should show remote infra type');
});

test('init --yes --infra-type remote without --mcp-url fails', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    [
      '--cwd', workspace, '--dry-run', 'init', '--yes',
      '--mode', 'indexed',
      '--infra-type', 'remote',
      '--business-canon', 'none',
    ],
    { cwd: workspace, env },
  );

  assert.notEqual(result.status, 0, 'should fail without --mcp-url');
  assert.ok(
    result.stderr.includes('--mcp-url is required'),
    'should report missing --mcp-url',
  );
});

test('init --yes --business-canon with local path stores local source', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  // Create a local canon directory in the temp workspace
  const localCanonDir = path.join(workspace, 'my-canon');
  fs.mkdirSync(localCanonDir, { recursive: true });

  // dry-run to avoid actual canon-sync; verify config write via executor log
  const result = runCli(
    [
      '--cwd', workspace, '--dry-run', 'init', '--yes',
      '--mode', 'file-only',
      '--business-canon', localCanonDir,
    ],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  // In dry-run mode the executor only logs file paths, not JSON content.
  // Verify local source was correctly detected by checking stage behaviour:
  // 1. GitHub auth stage should be skipped (proves source === 'local')
  assert.ok(
    result.stdout.includes('No GitHub canon configured; skipping GitHub authorization.'),
    'should skip GitHub auth for local canon',
  );
  // 2. Config-write stage should succeed
  assert.ok(
    result.stdout.includes('Write local collab configuration'),
    'config-write stage should have run',
  );
});

test('init --yes --business-canon with invalid local path fails', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    [
      '--cwd', workspace, '--dry-run', 'init', '--yes',
      '--mode', 'file-only',
      '--business-canon', '/nonexistent/path/to/canon',
    ],
    { cwd: workspace, env },
  );

  assert.notEqual(result.status, 0, 'should fail with invalid path');
  assert.ok(
    result.stderr.includes('Not a valid directory'),
    'should report invalid directory',
  );
});

test('init --yes --business-canon with owner/repo parses as github source in dry-run', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  // In --yes mode without --github-token, the pipeline fails at github-auth.
  // This proves the business canon was parsed correctly (it got past parsing).
  const result = runCli(
    [
      '--cwd', workspace, '--dry-run', 'init', '--yes',
      '--mode', 'file-only',
      '--business-canon', 'uxmaltech/collab-architecture',
    ],
    { cwd: workspace, env },
  );

  // The github-auth stage runs and fails because no token — proves the canon was accepted
  assert.notEqual(result.status, 0, 'should fail at github-auth without token');
  assert.ok(
    result.stderr.includes('github-auth'),
    'should fail at github-auth stage',
  );
  // Config-write stage succeeded before the failure
  assert.ok(
    result.stdout.includes('Write local collab configuration'),
    'config-write stage should have run',
  );
});
