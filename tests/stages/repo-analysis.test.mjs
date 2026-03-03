import assert from 'node:assert/strict';
import test from 'node:test';

import { runCli } from '../helpers/cli.mjs';
import { createFakeDockerEnv } from '../helpers/fake-docker.mjs';
import { makeTempWorkspace } from '../helpers/workspace.mjs';

test('repo-analysis skips when no providers are enabled', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();
  // Remove any AI provider keys
  delete env.OPENAI_API_KEY;
  delete env.ANTHROPIC_API_KEY;
  delete env.GOOGLE_AI_API_KEY;

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('No providers enabled') ||
      result.stdout.includes('skipping repository analysis'),
    'should skip analysis when no providers',
  );
});

test('repo-analysis skips with --skip-analysis flag', () => {
  const workspace = makeTempWorkspace();
  const env = {
    ...createFakeDockerEnv(),
    OPENAI_API_KEY: 'test-key',
  };

  const result = runCli(
    [
      '--cwd', workspace, '--dry-run', 'init', '--yes',
      '--mode', 'file-only', '--providers', 'codex', '--skip-analysis',
    ],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('Skipping repository analysis by user choice'),
    'should skip analysis when --skip-analysis is set',
  );
});

test('repo-analysis stage appears in dry-run output', () => {
  const workspace = makeTempWorkspace();
  const env = {
    ...createFakeDockerEnv(),
    OPENAI_API_KEY: 'test-key',
  };

  const result = runCli(
    [
      '--cwd', workspace, '--dry-run', 'init', '--yes',
      '--mode', 'file-only', '--providers', 'codex',
    ],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('AI-powered repository analysis'),
    'repo-analysis stage should appear in output',
  );
});
