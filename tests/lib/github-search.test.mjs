import assert from 'node:assert/strict';
import test from 'node:test';

// Static import — module structure and exports
import { searchGitHubRepos } from '../../dist/lib/github-search.js';

test('searchGitHubRepos is a function', () => {
  assert.equal(typeof searchGitHubRepos, 'function');
});

test('searchGitHubRepos rejects with invalid token', async () => {
  // GitHub returns 401 for invalid tokens — we expect a CliError
  await assert.rejects(
    () => searchGitHubRepos('collab', 'invalid-token-xxx', 2),
    (error) => {
      assert.ok(error.message.includes('GitHub search failed'), `Unexpected error: ${error.message}`);
      return true;
    },
  );
});
