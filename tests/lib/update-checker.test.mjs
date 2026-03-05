import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  readCheckState,
  writeCheckState,
  shouldCheck,
  fetchLatestVersion,
} = require('../../dist/lib/update-checker.js');

function makeTempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-update-'));
  return path.join(dir, 'update-check.json');
}

// ── readCheckState ──────────────────────────────────────────────────

test('readCheckState returns null when file does not exist', () => {
  const filePath = path.join(os.tmpdir(), `nonexistent-${Date.now()}.json`);
  const result = readCheckState(filePath);
  assert.equal(result, null);
});

test('readCheckState returns null for corrupt JSON', () => {
  const filePath = makeTempFile();
  fs.writeFileSync(filePath, 'not json', 'utf8');

  const result = readCheckState(filePath);
  assert.equal(result, null);
});

test('readCheckState returns null for JSON missing required fields', () => {
  const filePath = makeTempFile();
  fs.writeFileSync(filePath, '{"lastCheck": "2025-01-01"}', 'utf8');

  const result = readCheckState(filePath);
  assert.equal(result, null);
});

test('readCheckState returns valid state', () => {
  const filePath = makeTempFile();
  const state = { lastCheck: '2025-06-01T00:00:00.000Z', latestVersion: '1.2.3' };
  fs.writeFileSync(filePath, JSON.stringify(state), 'utf8');

  const result = readCheckState(filePath);
  assert.deepEqual(result, state);
});

// ── writeCheckState ─────────────────────────────────────────────────

test('writeCheckState creates parent directory and writes file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-update-'));
  const nested = path.join(dir, 'nested', 'update-check.json');

  const state = { lastCheck: '2025-06-01T00:00:00.000Z', latestVersion: '0.3.0' };
  writeCheckState(state, nested);

  assert.ok(fs.existsSync(nested));
  const written = JSON.parse(fs.readFileSync(nested, 'utf8'));
  assert.equal(written.latestVersion, '0.3.0');
});

// ── shouldCheck ─────────────────────────────────────────────────────

test('shouldCheck returns true when state is null (first run)', () => {
  assert.equal(shouldCheck(null), true);
});

test('shouldCheck returns false when checked recently', () => {
  const state = {
    lastCheck: new Date().toISOString(),
    latestVersion: '1.0.0',
  };
  assert.equal(shouldCheck(state), false);
});

test('shouldCheck returns true when last check is older than 24 hours', () => {
  const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
  const state = {
    lastCheck: oldDate.toISOString(),
    latestVersion: '1.0.0',
  };
  assert.equal(shouldCheck(state), true);
});

// ── fetchLatestVersion ──────────────────────────────────────────────

test('fetchLatestVersion returns null for nonexistent package', async () => {
  const result = await fetchLatestVersion('@uxmaltech/this-package-definitely-does-not-exist-9999');
  assert.equal(result, null);
});
