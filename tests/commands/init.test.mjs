import assert from 'node:assert/strict';
import test from 'node:test';

import { runCli } from '../helpers/cli.mjs';
import { createFakeDockerEnv } from '../helpers/fake-docker.mjs';
import { makeTempWorkspace } from '../helpers/workspace.mjs';

test('init interactive flow prompts in expected order', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();
  const input = '2\n\n\nn\n';

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
      '--skip-codex-config',
      '--ingest',
    ],
    {
      cwd: workspace,
      env,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /- mode: indexed/);
  assert.match(result.stdout, /- compose mode: split/);
  assert.match(result.stdout, /Skipping Codex config stage by user choice/i);
});
