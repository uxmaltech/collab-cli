import assert from 'node:assert/strict';
import test from 'node:test';

import { runCli } from '../helpers/cli.mjs';

test('collab ci ast-delta --help shows description and options', () => {
  const result = runCli(['ci', 'ast-delta', '--help']);

  assert.equal(result.status, 0);
  assert.ok(
    result.stdout.includes('Extract AST from files changed'),
    'should show command description',
  );
  assert.ok(
    result.stdout.includes('--base'),
    'should list --base option',
  );
});

test('collab ci --help lists ast-delta subcommand', () => {
  const result = runCli(['ci', '--help']);

  assert.equal(result.status, 0);
  assert.ok(
    result.stdout.includes('ast-delta'),
    'should list ast-delta subcommand',
  );
});

test('collab --help lists ci command', () => {
  const result = runCli(['--help']);

  assert.equal(result.status, 0);
  assert.ok(
    result.stdout.includes('ci'),
    'should list ci command',
  );
});
