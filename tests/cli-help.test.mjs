import assert from 'node:assert/strict';
import test from 'node:test';

import { runCli } from './helpers/cli.mjs';

test('collab --help exposes top-level commands', () => {
  const result = runCli(['--help']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: collab/);
  assert.match(result.stdout, /--version/);
  assert.match(result.stdout, /--dry-run/);
  assert.match(result.stdout, /init/);
  assert.match(result.stdout, /compose/);
  assert.match(result.stdout, /infra/);
  assert.match(result.stdout, /mcp/);
  assert.match(result.stdout, /up/);
  assert.match(result.stdout, /seed/);
  assert.match(result.stdout, /doctor/);
  assert.match(result.stdout, /upgrade/);
  assert.match(result.stdout, /uninstall/);
});

test('compose, infra, and mcp commands expose help examples', () => {
  const compose = runCli(['compose', '--help']);
  assert.equal(compose.status, 0, compose.stderr);
  assert.match(compose.stdout, /compose generate --mode consolidated/);

  const infra = runCli(['infra', '--help']);
  assert.equal(infra.status, 0, infra.stderr);
  assert.match(infra.stdout, /collab infra up/);

  const mcp = runCli(['mcp', '--help']);
  assert.equal(mcp.status, 0, mcp.stderr);
  assert.match(mcp.stdout, /collab mcp start/);

  const up = runCli(['up', '--help']);
  assert.equal(up.status, 0, up.stderr);
  assert.match(up.stdout, /full startup pipeline/);
});
