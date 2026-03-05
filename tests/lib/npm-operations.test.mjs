import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { requireNpm } = require('../../dist/lib/npm-operations.js');

test('requireNpm returns a string path when npm is available', () => {
  // npm should be available in the test environment
  const result = requireNpm();
  assert.equal(typeof result, 'string');
  assert.ok(result.length > 0, 'npm path should be non-empty');
  assert.ok(result.includes('npm'), 'path should contain npm');
});

test('requireNpm returns null when npm is not in PATH', () => {
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = '/nonexistent-directory';
    const result = requireNpm();
    assert.equal(result, null);
  } finally {
    process.env.PATH = originalPath;
  }
});
