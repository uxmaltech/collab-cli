import assert from 'node:assert/strict';
import test from 'node:test';

import { runCli } from '../helpers/cli.mjs';
import { makeTempWorkspace } from '../helpers/workspace.mjs';

test('mcp start validates --timeout-ms as positive integer', () => {
  const workspace = makeTempWorkspace();
  const result = runCli(['--cwd', workspace, 'mcp', 'start', '--timeout-ms', '0'], { cwd: workspace });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--timeout-ms must be a positive integer/i);
});

test('mcp start validates --retries as positive integer', () => {
  const workspace = makeTempWorkspace();
  const result = runCli(['--cwd', workspace, 'mcp', 'start', '--retries', '-1'], { cwd: workspace });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--retries must be a positive integer/i);
});

test('mcp start validates --retry-delay-ms as positive integer', () => {
  const workspace = makeTempWorkspace();
  const result = runCli(['--cwd', workspace, 'mcp', 'start', '--retry-delay-ms', 'bad'], { cwd: workspace });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--retry-delay-ms must be a positive integer/i);
});
