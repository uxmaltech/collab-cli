import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseMode, DEFAULT_MODE } = require('../../dist/lib/mode.js');

test('parseMode uses fallback only when value is undefined', () => {
  assert.equal(parseMode(undefined, 'indexed'), 'indexed');
  assert.equal(parseMode(undefined), DEFAULT_MODE);
});

test('parseMode rejects empty and invalid values', () => {
  assert.throws(() => parseMode(''));
  assert.throws(() => parseMode('unknown-mode'));
});

test('parseMode accepts known values', () => {
  assert.equal(parseMode('file-only'), 'file-only');
  assert.equal(parseMode('indexed'), 'indexed');
});
