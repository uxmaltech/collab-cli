import assert from 'node:assert/strict';
import test from 'node:test';

// Static import — module structure and exports
import { searchGitHubRepos, listGitHubBranches } from '../../dist/lib/github-search.js';

test('searchGitHubRepos is a function', () => {
  assert.equal(typeof searchGitHubRepos, 'function');
});

test('searchGitHubRepos rejects with CliError on 401', async (t) => {
  // Mock global fetch to return a 401 — avoids live GitHub API calls in CI
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    text: async () => '{"message":"Bad credentials"}',
  }));

  await assert.rejects(
    () => searchGitHubRepos('collab', 'invalid-token-xxx', 2),
    (error) => {
      assert.ok(
        error.message.includes('GitHub search failed'),
        `Unexpected error: ${error.message}`,
      );
      assert.ok(
        error.message.includes('401'),
        'should include HTTP status code',
      );
      return true;
    },
  );
});

test('searchGitHubRepos parses successful response', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      total_count: 1,
      items: [
        {
          full_name: 'org/repo',
          description: 'A test repo',
          private: false,
          default_branch: 'main',
        },
      ],
    }),
  }));

  const result = await searchGitHubRepos('test', 'fake-token', 5);
  assert.equal(result.totalCount, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].fullName, 'org/repo');
  assert.equal(result.items[0].description, 'A test repo');
  assert.equal(result.items[0].private, false);
  assert.equal(result.items[0].defaultBranch, 'main');
});

// ── listGitHubBranches ──────────────────────────────────────────

test('listGitHubBranches returns sorted branches with default first', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => ([
      { name: 'feature-b' },
      { name: 'main' },
      { name: 'development' },
    ]),
  }));

  const branches = await listGitHubBranches('org/repo', 'fake-token', 'main');
  assert.equal(branches[0], 'main');
  assert.ok(branches.includes('development'));
  assert.ok(branches.includes('feature-b'));
});

test('listGitHubBranches returns empty array for empty repo', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => ([]),
  }));

  const branches = await listGitHubBranches('org/empty-repo', 'fake-token', 'main');
  assert.deepEqual(branches, []);
});

test('listGitHubBranches falls back on non-200', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false,
    status: 404,
  }));

  const branches = await listGitHubBranches('org/repo', 'fake-token', 'main');
  assert.deepEqual(branches, ['main']);
});

test('listGitHubBranches falls back to main when no default specified', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false,
    status: 500,
  }));

  const branches = await listGitHubBranches('org/repo', 'fake-token');
  assert.deepEqual(branches, ['main']);
});
