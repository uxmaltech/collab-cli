import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binary = path.resolve(__dirname, '../bin/collab');

test('collab --help exposes version and available commands', () => {
  const result = spawnSync(binary, ['--help'], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: collab/);
  assert.match(result.stdout, /--version/);
  assert.match(result.stdout, /Commands:/);
  assert.match(result.stdout, /doctor/);
});
