import assert from 'node:assert/strict';
import test from 'node:test';

import { runCli } from '../helpers/cli.mjs';

test('collab upgrade --help shows description and options', () => {
  const result = runCli(['upgrade', '--help']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Check for and install the latest version/);
  assert.match(result.stdout, /--check/);
});

test('collab --help lists upgrade command', () => {
  const result = runCli(['--help']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /upgrade/);
});
