import assert from 'node:assert/strict';
import test from 'node:test';

const { detectProviderCli, detectAllClis } = await import('../../dist/lib/cli-detection.js');

test('detectProviderCli returns CliInfo shape for codex', () => {
  const info = detectProviderCli('codex');

  assert.equal(info.command, 'codex');
  assert.equal(typeof info.available, 'boolean');

  if (info.available) {
    assert.ok(info.version === undefined || typeof info.version === 'string');
    // configuredModel is optional — read from CLI config file if present
    assert.ok(
      info.configuredModel === undefined || typeof info.configuredModel === 'string',
      'configuredModel should be string or undefined',
    );
  }
});

test('detectProviderCli returns CliInfo shape for claude', () => {
  const info = detectProviderCli('claude');

  assert.equal(info.command, 'claude');
  assert.equal(typeof info.available, 'boolean');
});

test('detectProviderCli returns CliInfo shape for gemini', () => {
  const info = detectProviderCli('gemini');

  assert.equal(info.command, 'gemini');
  assert.equal(typeof info.available, 'boolean');
});

test('detectAllClis returns entries for all providers', () => {
  const all = detectAllClis();

  assert.ok(all.codex, 'should have codex entry');
  assert.ok(all.claude, 'should have claude entry');
  assert.ok(all.gemini, 'should have gemini entry');

  assert.equal(all.codex.command, 'codex');
  assert.equal(all.claude.command, 'claude');
  assert.equal(all.gemini.command, 'gemini');
});

// Integration: if claude is on this machine, verify it detected
test('detectProviderCli detects claude if installed', { skip: !process.env.CI }, () => {
  // This test runs in CI or when explicitly not skipped
  const info = detectProviderCli('claude');

  // We can't assert available=true since it depends on the machine,
  // but we verify the shape is correct
  assert.equal(info.command, 'claude');
  assert.equal(typeof info.available, 'boolean');
});
