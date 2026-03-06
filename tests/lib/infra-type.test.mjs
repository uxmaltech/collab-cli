import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseInfraType, validateMcpUrl, DEFAULT_INFRA_TYPE } = require('../../dist/lib/infra-type.js');

// ── parseInfraType ──────────────────────────────────────────

test('parseInfraType uses fallback only when value is undefined', () => {
  assert.equal(parseInfraType(undefined, 'remote'), 'remote');
  assert.equal(parseInfraType(undefined), DEFAULT_INFRA_TYPE);
});

test('parseInfraType rejects empty and invalid values', () => {
  assert.throws(() => parseInfraType(''));
  assert.throws(() => parseInfraType('cloud'));
  assert.throws(() => parseInfraType('LOCAL'));
});

test('parseInfraType accepts known values', () => {
  assert.equal(parseInfraType('local'), 'local');
  assert.equal(parseInfraType('remote'), 'remote');
});

// ── validateMcpUrl ──────────────────────────────────────────

test('validateMcpUrl accepts valid http URLs', () => {
  assert.equal(validateMcpUrl('http://localhost:7337'), 'http://localhost:7337');
  assert.equal(validateMcpUrl('http://my-server:7337'), 'http://my-server:7337');
  assert.equal(validateMcpUrl('https://mcp.example.com'), 'https://mcp.example.com');
});

test('validateMcpUrl strips trailing slashes', () => {
  assert.equal(validateMcpUrl('http://localhost:7337/'), 'http://localhost:7337');
  assert.equal(validateMcpUrl('http://localhost:7337///'), 'http://localhost:7337');
});

test('validateMcpUrl strips trailing paths (returns origin only)', () => {
  assert.equal(validateMcpUrl('http://localhost:7337/mcp'), 'http://localhost:7337');
  assert.equal(validateMcpUrl('http://server:8080/api/v1'), 'http://server:8080');
});

test('validateMcpUrl trims whitespace', () => {
  assert.equal(validateMcpUrl('  http://localhost:7337  '), 'http://localhost:7337');
});

test('validateMcpUrl rejects empty input', () => {
  assert.throws(() => validateMcpUrl(''), /cannot be empty/i);
  assert.throws(() => validateMcpUrl('   '), /cannot be empty/i);
});

test('validateMcpUrl rejects non-http schemes', () => {
  assert.throws(() => validateMcpUrl('ftp://server:21'), /must start with http/i);
  assert.throws(() => validateMcpUrl('ws://server:7337'), /must start with http/i);
  assert.throws(() => validateMcpUrl('localhost:7337'), /must start with http/i);
});

test('validateMcpUrl rejects unparseable URLs', () => {
  assert.throws(() => validateMcpUrl('http://'), /invalid/i);
});
