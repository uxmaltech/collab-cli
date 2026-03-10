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
  getAuthenticatedUser,
  listUserOrgs,
  createGitHubRepo,
  createInitialReadme,
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

test('normalizeGitHubRemote parses HTTPS URL with x-access-token credentials', () => {
  assert.equal(
    normalizeGitHubRemote('https://x-access-token:gho_abc123@github.com/anystream/api-server.git'),
    'anystream/api-server',
  );
});

test('normalizeGitHubRemote parses HTTPS URL with user:pass credentials', () => {
  assert.equal(
    normalizeGitHubRemote('https://user:token@github.com/org/repo.git'),
    'org/repo',
  );
});

test('normalizeGitHubRemote rejects subdomain spoofing (notgithub.com)', () => {
  assert.equal(normalizeGitHubRemote('https://notgithub.com/org/repo.git'), null);
});

test('normalizeGitHubRemote rejects domain suffix spoofing (github.com.evil.tld)', () => {
  assert.equal(normalizeGitHubRemote('https://github.com.evil.tld/org/repo.git'), null);
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

test('setBranchProtection uses defaults when no config provided', async (t) => {
  let capturedBody;
  t.mock.method(globalThis, 'fetch', async (_url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return { ok: true, status: 200 };
  });

  await setBranchProtection('org/repo', 'main', 'token');

  assert.equal(capturedBody.required_status_checks, null);
  assert.equal(capturedBody.enforce_admins, false);
  assert.equal(capturedBody.required_pull_request_reviews.required_approving_review_count, 1);
  assert.equal(capturedBody.required_pull_request_reviews.dismiss_stale_reviews, true);
  assert.equal(capturedBody.restrictions, null);
});

test('setBranchProtection applies custom config', async (t) => {
  let capturedBody;
  t.mock.method(globalThis, 'fetch', async (_url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return { ok: true, status: 200 };
  });

  await setBranchProtection('org/repo', 'main', 'token', {
    requiredApprovals: 2,
    dismissStaleReviews: false,
    enforceAdmins: true,
    requiredStatusChecks: ['ci/build', 'ci/test'],
  });

  assert.deepEqual(capturedBody.required_status_checks, { strict: true, contexts: ['ci/build', 'ci/test'] });
  assert.equal(capturedBody.enforce_admins, true);
  assert.equal(capturedBody.required_pull_request_reviews.required_approving_review_count, 2);
  assert.equal(capturedBody.required_pull_request_reviews.dismiss_stale_reviews, false);
});

test('setBranchProtection with empty requiredStatusChecks uses null', async (t) => {
  let capturedBody;
  t.mock.method(globalThis, 'fetch', async (_url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return { ok: true, status: 200 };
  });

  await setBranchProtection('org/repo', 'main', 'token', { requiredStatusChecks: [] });

  assert.equal(capturedBody.required_status_checks, null);
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

// ── getAuthenticatedUser ──────────────────────────────────────

test('getAuthenticatedUser returns login on 200', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => ({ login: 'testuser' }),
  }));

  const login = await getAuthenticatedUser('token');
  assert.equal(login, 'testuser');
});

test('getAuthenticatedUser throws on 401', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
  }));

  await assert.rejects(() => getAuthenticatedUser('bad-token'), /GitHub API error 401/);
});

// ── listUserOrgs ──────────────────────────────────────────────

test('listUserOrgs returns org logins on 200', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => ([
      { login: 'org-b' },
      { login: 'org-a' },
    ]),
  }));

  const orgs = await listUserOrgs('token');
  assert.deepEqual(orgs, ['org-a', 'org-b']);
});

test('listUserOrgs returns empty array on error', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false,
    status: 403,
  }));

  const orgs = await listUserOrgs('token');
  assert.deepEqual(orgs, []);
});

// ── createGitHubRepo ──────────────────────────────────────────

test('createGitHubRepo creates user repo on 201', async (t) => {
  let capturedUrl;
  let capturedBody;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    capturedUrl = typeof url === 'string' ? url : url.toString();
    capturedBody = JSON.parse(opts.body);
    return {
      ok: true,
      status: 201,
      json: async () => ({
        full_name: 'testuser/my-repo',
        default_branch: 'main',
        private: true,
      }),
    };
  });

  const result = await createGitHubRepo({ name: 'my-repo', isPrivate: true }, 'token');
  assert.equal(result.fullName, 'testuser/my-repo');
  assert.equal(result.private, true);
  assert.ok(capturedUrl.endsWith('/user/repos'), `expected user repos URL, got ${capturedUrl}`);
  assert.equal(capturedBody.name, 'my-repo');
  assert.equal(capturedBody.private, true);
});

test('createGitHubRepo creates org repo when org provided', async (t) => {
  let capturedUrl;
  t.mock.method(globalThis, 'fetch', async (url) => {
    capturedUrl = typeof url === 'string' ? url : url.toString();
    return {
      ok: true,
      status: 201,
      json: async () => ({
        full_name: 'myorg/my-repo',
        default_branch: 'main',
        private: false,
      }),
    };
  });

  const result = await createGitHubRepo({ name: 'my-repo', org: 'myorg', isPrivate: false }, 'token');
  assert.equal(result.fullName, 'myorg/my-repo');
  assert.ok(capturedUrl.includes('/orgs/myorg/repos'), `expected org repos URL, got ${capturedUrl}`);
});

test('createGitHubRepo throws on failure', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false,
    status: 422,
    statusText: 'Unprocessable Entity',
    text: async () => '{"message":"name already exists"}',
  }));

  await assert.rejects(
    () => createGitHubRepo({ name: 'existing' }, 'token'),
    /GitHub repo creation failed.*422/,
  );
});

// ── createInitialReadme ───────────────────────────────────────

test('createInitialReadme sends correct PUT request', async (t) => {
  let capturedUrl;
  let capturedBody;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    capturedUrl = typeof url === 'string' ? url : url.toString();
    capturedBody = JSON.parse(opts.body);
    return { ok: true, status: 201 };
  });

  await createInitialReadme('org/my-repo', 'main', 'token');

  assert.ok(capturedUrl.includes('/repos/org/my-repo/contents/README.md'));
  assert.equal(capturedBody.message, 'Initial commit');
  assert.equal(capturedBody.branch, 'main');
  // Verify content is base64 of "# my-repo\n"
  const decoded = Buffer.from(capturedBody.content, 'base64').toString();
  assert.equal(decoded, '# my-repo\n');
});

test('createInitialReadme throws on failure', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false,
    status: 409,
    statusText: 'Conflict',
    text: async () => '{"message":"sha mismatch"}',
  }));

  await assert.rejects(
    () => createInitialReadme('org/repo', 'main', 'token'),
    /Failed to create initial README/,
  );
});
