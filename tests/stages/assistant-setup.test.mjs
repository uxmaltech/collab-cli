import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../helpers/cli.mjs';
import { createFakeDockerEnv } from '../helpers/fake-docker.mjs';
import { makeTempWorkspace } from '../helpers/workspace.mjs';
import { createBufferedLogger, createTestConfig } from '../helpers/test-context.mjs';

test('assistant-setup stage appears in init flow', () => {
  const workspace = makeTempWorkspace();
  const env = {
    ...createFakeDockerEnv(),
    OPENAI_API_KEY: 'test-key-for-detection',
  };

  // Use --yes for non-interactive, which auto-detects OPENAI_API_KEY
  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);

  // The stage title should appear in output
  assert.ok(
    result.stdout.includes('Configure AI assistant providers'),
    'assistant-setup stage should appear in init output: ' + result.stdout,
  );
});

test('init --yes --providers codex configures codex with api-key', () => {
  const workspace = makeTempWorkspace();
  const env = {
    ...createFakeDockerEnv(),
    OPENAI_API_KEY: 'test-key-value',
  };

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--providers', 'codex', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);

  // Check summary includes provider info
  assert.ok(
    result.stdout.includes('Codex') || result.stdout.includes('codex'),
    'output should mention codex provider',
  );
});

test('init --yes --providers codex,claude configures multiple providers', () => {
  const workspace = makeTempWorkspace();
  const env = {
    ...createFakeDockerEnv(),
    OPENAI_API_KEY: 'test-openai-key',
    ANTHROPIC_API_KEY: 'test-anthropic-key',
  };

  const result = runCli(
    [
      '--cwd', workspace, '--dry-run', 'init', '--yes',
      '--providers', 'codex,claude', '--mode', 'file-only',
    ],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
  assert.ok(result.stdout.includes('Codex'), 'output should mention Codex');
  assert.ok(result.stdout.includes('Claude'), 'output should mention Claude');
});

test('init --yes auto-detects providers from environment', () => {
  const workspace = makeTempWorkspace();
  const env = {
    ...createFakeDockerEnv(),
    ANTHROPIC_API_KEY: 'test-key',
  };

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('Auto-detected') || result.stdout.includes('Claude'),
    'should auto-detect ANTHROPIC_API_KEY',
  );
});

test('init --yes with no env vars skips assistant-setup gracefully', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();
  // Remove any AI provider keys from env
  delete env.OPENAI_API_KEY;
  delete env.ANTHROPIC_API_KEY;
  delete env.GOOGLE_AI_API_KEY;

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('no providers') ||
      result.stdout.includes('Skipping assistant-setup') ||
      result.stdout.includes('none configured'),
    'should indicate no providers configured',
  );
});

test('init --providers with invalid provider name fails', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--providers', 'invalid', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.notEqual(result.status, 0, 'should fail with invalid provider');
});

test('config persists assistants after setup', () => {
  const workspace = makeTempWorkspace();
  const env = {
    ...createFakeDockerEnv(),
    OPENAI_API_KEY: 'test-key',
  };

  // Run with actual file writes (no --dry-run) but use file-only mode to skip docker
  const result = runCli(
    ['--cwd', workspace, 'init', '--yes', '--providers', 'codex', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);

  // Verify config file contains assistants
  const configPath = path.join(workspace, '.collab', 'config.json');
  assert.ok(fs.existsSync(configPath), 'config file should exist');

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.ok(config.assistants, 'config should have assistants field');
  assert.ok(config.assistants.providers, 'config should have providers');
  assert.ok(config.assistants.providers.codex, 'codex should be configured');
  assert.equal(config.assistants.providers.codex.enabled, true, 'codex should be enabled');
  assert.equal(config.assistants.providers.codex.auth.method, 'api-key', 'auth method should be api-key');
  assert.equal(config.assistants.providers.codex.auth.envVar, 'OPENAI_API_KEY', 'envVar should be OPENAI_API_KEY');
});

test('resume skips assistant-setup when already completed', () => {
  const workspace = makeTempWorkspace();
  const env = {
    ...createFakeDockerEnv(),
    OPENAI_API_KEY: 'test-key',
  };

  // First run
  const first = runCli(
    ['--cwd', workspace, 'init', '--yes', '--providers', 'codex', '--mode', 'file-only'],
    { cwd: workspace, env },
  );
  assert.equal(first.status, 0, `initial CLI failed: ${first.stderr}`);

  // Second run with --resume
  const result = runCli(
    ['--cwd', workspace, 'init', '--yes', '--resume', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('Skipping completed stage') || result.stdout.includes('Resuming'),
    'should indicate stages are being skipped on resume',
  );
});
