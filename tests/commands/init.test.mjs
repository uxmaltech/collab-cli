import assert from 'node:assert/strict';
import test from 'node:test';

import { runCli } from '../helpers/cli.mjs';
import { createFakeDockerEnv } from '../helpers/fake-docker.mjs';
import { makeTempWorkspace } from '../helpers/workspace.mjs';

test('init interactive flow prompts in expected order', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();
  const input = '2\n\nn\n';

  const result = runCli(['--cwd', workspace, '--dry-run', 'init'], {
    cwd: workspace,
    env,
    input,
  });

  assert.equal(result.status, 0, result.stderr);

  const modePrompt = result.stdout.indexOf('Select setup mode:');
  const composePrompt = result.stdout.indexOf('Select compose generation mode:');

  assert.ok(modePrompt >= 0, 'mode prompt missing');
  assert.ok(composePrompt > modePrompt, 'compose prompt order mismatch');
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
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--mode', 'file-only'],
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
