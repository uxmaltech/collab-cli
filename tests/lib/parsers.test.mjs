import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseNumber, parsePositiveInt, parseHealthOptions } = require('../../dist/lib/parsers.js');

// ── parseNumber ──────────────────────────────────────────────────────

test('parseNumber returns fallback when value is undefined', () => {
  assert.equal(parseNumber(undefined, 42), 42);
});

test('parseNumber returns fallback when value is empty string', () => {
  assert.equal(parseNumber('', 42), 42);
});

test('parseNumber parses valid integer strings', () => {
  assert.equal(parseNumber('100', 0), 100);
  assert.equal(parseNumber('0', 5), 0);
  assert.equal(parseNumber('999', 1), 999);
});

test('parseNumber returns fallback for non-numeric strings', () => {
  assert.equal(parseNumber('abc', 7), 7);
  assert.equal(parseNumber('12.5', 7), 12); // parseInt truncates
});

// ── parsePositiveInt ─────────────────────────────────────────────────

test('parsePositiveInt returns fallback when value is undefined', () => {
  assert.equal(parsePositiveInt('--retries', undefined, 15), 15);
});

test('parsePositiveInt parses valid positive integers', () => {
  assert.equal(parsePositiveInt('--retries', '10', 15), 10);
  assert.equal(parsePositiveInt('--retries', '1', 15), 1);
});

test('parsePositiveInt throws for zero', () => {
  assert.throws(
    () => parsePositiveInt('--retries', '0', 15),
    /--retries must be a positive integer/,
  );
});

test('parsePositiveInt throws for negative values', () => {
  assert.throws(
    () => parsePositiveInt('--retries', '-5', 15),
    /--retries must be a positive integer/,
  );
});

test('parsePositiveInt throws for non-integer values', () => {
  assert.throws(
    () => parsePositiveInt('--retries', '3.5', 15),
    /--retries must be a positive integer/,
  );
});

test('parsePositiveInt throws for non-numeric strings', () => {
  assert.throws(
    () => parsePositiveInt('--retries', 'abc', 15),
    /--retries must be a positive integer/,
  );
});

// ── parseHealthOptions ───────────────────────────────────────────────

test('parseHealthOptions returns defaults when no options provided', () => {
  const result = parseHealthOptions({});
  assert.deepEqual(result, {
    timeoutMs: 5_000,
    retries: 15,
    retryDelayMs: 2_000,
  });
});

test('parseHealthOptions parses provided values', () => {
  const result = parseHealthOptions({
    timeoutMs: '3000',
    retries: '20',
    retryDelayMs: '1000',
  });
  assert.deepEqual(result, {
    timeoutMs: 3000,
    retries: 20,
    retryDelayMs: 1000,
  });
});

test('parseHealthOptions uses defaults for partially provided options', () => {
  const result = parseHealthOptions({ retries: '10' });
  assert.equal(result.retries, 10);
  assert.equal(result.timeoutMs, 5_000);
  assert.equal(result.retryDelayMs, 2_000);
});
