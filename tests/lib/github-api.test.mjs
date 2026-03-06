import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeGitHubRemote,
  resolveGitHubOwnerRepo,
  verifyGitHubAccess,
} from '../../dist/lib/github-api.js';

// ── normalizeGitHubRemote ─────────────────────────────────────

test('normalizeGitHubRemote parses HTTPS URL', () => {
  assert.equal(normalizeGitHubRemote('https://github.com/uxmaltech/collab-cli.git'), 'uxmaltech/collab-cli');
});

test('normalizeGitHubRemote parses HTTPS URL without .git', () => {
  assert.equal(normalizeGitHubRemote('https://github.com/uxmaltech/collab-cli'), 'uxmaltech/collab-cli');
});

test('normalizeGitHubRemote parses SSH URL', () => {
  assert.equal(normalizeGitHubRemote('git@github.com:uxmaltech/collab-cli.git'), 'uxmaltech/collab-cli');
});

test('normalizeGitHubRemote parses ssh:// URL', () => {
  assert.equal(normalizeGitHubRemote('ssh://git@github.com/uxmaltech/collab-cli.git'), 'uxmaltech/collab-cli');
});

test('normalizeGitHubRemote returns null for non-GitHub URL', () => {
  assert.equal(normalizeGitHubRemote('https://gitlab.com/org/repo.git'), null);
});

test('normalizeGitHubRemote returns null for malformed URL', () => {
  assert.equal(normalizeGitHubRemote('github.com'), null);
});

test('normalizeGitHubRemote handles trailing slashes', () => {
  assert.equal(normalizeGitHubRemote('https://github.com/uxmaltech/collab-cli/'), 'uxmaltech/collab-cli');
});

// ── resolveGitHubOwnerRepo ────────────────────────────────────

test('resolveGitHubOwnerRepo returns null for non-git directory', () => {
  const result = resolveGitHubOwnerRepo('/tmp/not-a-git-repo-' + Date.now());
  assert.equal(result, null);
});

// ── verifyGitHubAccess ────────────────────────────────────────

test('verifyGitHubAccess returns true on 200', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    status: 200,
  }));

  const result = await verifyGitHubAccess('uxmaltech/collab-cli', 'fake-token');
  assert.equal(result, true);
});

test('verifyGitHubAccess returns false on 401', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false,
    status: 401,
  }));

  const result = await verifyGitHubAccess('uxmaltech/collab-cli', 'bad-token');
  assert.equal(result, false);
});

test('verifyGitHubAccess returns false on 404', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false,
    status: 404,
  }));

  const result = await verifyGitHubAccess('nonexistent/repo', 'fake-token');
  assert.equal(result, false);
});

test('verifyGitHubAccess returns false on network error', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('network failure');
  });

  const result = await verifyGitHubAccess('uxmaltech/collab-cli', 'fake-token');
  assert.equal(result, false);
});
