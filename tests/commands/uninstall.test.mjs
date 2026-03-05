import assert from 'node:assert/strict';
import test from 'node:test';

import { runCli } from '../helpers/cli.mjs';

test('collab uninstall --help shows description and options', () => {
  const result = runCli(['uninstall', '--help']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Uninstall collab-cli/);
  assert.match(result.stdout, /--yes/);
});

test('collab --help lists uninstall command', () => {
  const result = runCli(['--help']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /uninstall/);
});
