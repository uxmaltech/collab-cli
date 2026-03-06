import assert from 'node:assert/strict';
import test from 'node:test';

import { guardMainPrTemplate, canonSyncTriggerTemplate } from '../../dist/templates/ci/index.js';

// ── guardMainPrTemplate ───────────────────────────────────────

test('guardMainPrTemplate is a non-empty string', () => {
  assert.equal(typeof guardMainPrTemplate, 'string');
  assert.ok(guardMainPrTemplate.length > 0);
});

test('guardMainPrTemplate contains expected content', () => {
  assert.ok(guardMainPrTemplate.includes('Guard Main PR Source'), 'should contain workflow name');
  assert.ok(guardMainPrTemplate.includes('development'), 'should reference development branch');
  assert.ok(guardMainPrTemplate.includes('pull_request'), 'should trigger on pull_request');
  assert.ok(guardMainPrTemplate.includes('branches: [main]'), 'should target main branch');
});

// ── canonSyncTriggerTemplate ──────────────────────────────────

test('canonSyncTriggerTemplate is a function', () => {
  assert.equal(typeof canonSyncTriggerTemplate, 'function');
});

test('canonSyncTriggerTemplate produces valid output', () => {
  const result = canonSyncTriggerTemplate('uxmaltech/collab-architecture');
  assert.equal(typeof result, 'string');
  assert.ok(result.length > 0);
});

test('canonSyncTriggerTemplate includes canon repo slug', () => {
  const result = canonSyncTriggerTemplate('uxmaltech/collab-architecture');
  assert.ok(result.includes('uxmaltech/collab-architecture'), 'should include canon repo slug');
});

test('canonSyncTriggerTemplate references CANON_SYNC_PAT', () => {
  const result = canonSyncTriggerTemplate('org/repo');
  assert.ok(result.includes('CANON_SYNC_PAT'), 'should reference CANON_SYNC_PAT secret');
});

test('canonSyncTriggerTemplate triggers on push to main', () => {
  const result = canonSyncTriggerTemplate('org/repo');
  assert.ok(result.includes('push'), 'should trigger on push');
  assert.ok(result.includes('branches: [main]'), 'should target main branch');
});
