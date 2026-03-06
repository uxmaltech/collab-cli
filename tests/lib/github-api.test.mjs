import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeGitHubRemote,
  resolveGitHubOwnerRepo,
  verifyGitHubAccess,
  getRepoInfo,
  getBranchRef,
  createBranch,
  setDefaultBranch,
  setBranchProtection,
  setMergeStrategy,
  configureRepo,
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

// ── getRepoInfo ───────────────────────────────────────────────

test('getRepoInfo returns repo metadata on 200', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      default_branch: 'main',
      allow_merge_commit: true,
      allow_squash_merge: true,
      allow_rebase_merge: true,
      delete_branch_on_merge: false,
    }),
  }));

  const info = await getRepoInfo('org/repo', 'token');
  assert.equal(info.default_branch, 'main');
  assert.equal(info.allow_merge_commit, true);
  assert.equal(info.delete_branch_on_merge, false);
});

test('getRepoInfo throws on non-200', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false,
    status: 404,
    statusText: 'Not Found',
  }));

  await assert.rejects(() => getRepoInfo('org/repo', 'token'), /GitHub API error 404/);
});

// ── getBranchRef ──────────────────────────────────────────────

test('getBranchRef returns SHA on 200', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => ({ object: { sha: 'abc123' } }),
  }));

  const sha = await getBranchRef('org/repo', 'main', 'token');
  assert.equal(sha, 'abc123');
});

test('getBranchRef returns null on 404', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false,
    status: 404,
  }));

  const sha = await getBranchRef('org/repo', 'nonexistent', 'token');
  assert.equal(sha, null);
});

// ── createBranch ──────────────────────────────────────────────

test('createBranch succeeds on 201', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    status: 201,
  }));

  await createBranch('org/repo', 'development', 'abc123', 'token');
  // No throw = success
});

test('createBranch swallows 422 (already exists)', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false,
    status: 422,
  }));

  await createBranch('org/repo', 'development', 'abc123', 'token');
  // No throw = idempotent success
});

// ── setDefaultBranch ──────────────────────────────────────────

test('setDefaultBranch succeeds on 200', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    status: 200,
  }));

  await setDefaultBranch('org/repo', 'development', 'token');
});

// ── setBranchProtection ───────────────────────────────────────

test('setBranchProtection succeeds on 200', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    status: 200,
  }));

  await setBranchProtection('org/repo', 'main', 'token');
});

// ── setMergeStrategy ──────────────────────────────────────────

test('setMergeStrategy succeeds on 200', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    status: 200,
  }));

  await setMergeStrategy('org/repo', 'token');
});

// ── configureRepo ─────────────────────────────────────────────

test('configureRepo orchestrates full configuration', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    calls.push({ url: urlStr, method: opts?.method || 'GET' });

    // getRepoInfo
    if (urlStr.endsWith('/repos/org/repo') && (!opts?.method || opts.method === 'GET')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          default_branch: 'main',
          allow_merge_commit: true,
          allow_squash_merge: true,
          allow_rebase_merge: true,
          delete_branch_on_merge: false,
        }),
      };
    }

    // getBranchRef — both exist
    if (urlStr.includes('/git/ref/heads/')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ object: { sha: 'abc123' } }),
      };
    }

    // PATCH or PUT
    return { ok: true, status: 200 };
  });

  const logs = [];
  const logger = { info: (msg) => logs.push(msg), warn: (msg) => logs.push(`WARN: ${msg}`) };

  await configureRepo('org/repo', 'token', logger);

  assert.ok(calls.length >= 4, `expected at least 4 API calls, got ${calls.length}`);
  assert.ok(logs.some((l) => l.includes('Configuring branch model')));
});
