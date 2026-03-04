import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { makeTempWorkspace } from '../helpers/workspace.mjs';

// Dynamic import to pick up the compiled output
const {
  isWorkspaceMode,
  resolveRepoConfigs,
  discoverRepos,
  isWorkspaceRoot,
} = await import('../../dist/lib/config.js');

test('isWorkspaceMode returns false when no workspace config', () => {
  assert.equal(isWorkspaceMode({ workspaceDir: '/tmp' }), false);
  assert.equal(isWorkspaceMode({ workspaceDir: '/tmp', workspace: undefined }), false);
});

test('isWorkspaceMode returns true with repos', () => {
  assert.equal(
    isWorkspaceMode({ workspaceDir: '/tmp', workspace: { repos: ['a', 'b'] } }),
    true,
  );
});

test('isWorkspaceMode returns false with empty repos array', () => {
  assert.equal(
    isWorkspaceMode({ workspaceDir: '/tmp', workspace: { repos: [] } }),
    false,
  );
});

test('resolveRepoConfigs returns empty array without workspace', () => {
  const result = resolveRepoConfigs({ workspaceDir: '/ws' });
  assert.deepEqual(result, []);
});

test('resolveRepoConfigs computes correct paths', () => {
  const config = {
    workspaceDir: '/ws',
    workspace: { repos: ['api', 'web'] },
  };

  const result = resolveRepoConfigs(config);

  assert.equal(result.length, 2);

  assert.equal(result[0].name, 'api');
  assert.equal(result[0].repoDir, path.join('/ws', 'api'));
  assert.equal(result[0].architectureRepoDir, path.join('/ws', 'api', 'docs', 'architecture', 'repo'));
  assert.equal(result[0].aiDir, path.join('/ws', 'api', 'docs', 'ai'));

  assert.equal(result[1].name, 'web');
  assert.equal(result[1].repoDir, path.join('/ws', 'web'));
});

test('discoverRepos finds directories with .git', () => {
  const workspace = makeTempWorkspace();
  fs.mkdirSync(path.join(workspace, 'repo-a', '.git'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'repo-b', '.git'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'not-a-repo'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'file.txt'), 'hello');

  const repos = discoverRepos(workspace);
  assert.deepEqual(repos, ['repo-a', 'repo-b']);
});

test('discoverRepos skips dot-directories', () => {
  const workspace = makeTempWorkspace();
  fs.mkdirSync(path.join(workspace, '.hidden', '.git'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'visible', '.git'), { recursive: true });

  const repos = discoverRepos(workspace);
  assert.deepEqual(repos, ['visible']);
});

test('discoverRepos returns empty for workspace with no repos', () => {
  const workspace = makeTempWorkspace();
  fs.mkdirSync(path.join(workspace, 'plain-dir'), { recursive: true });

  const repos = discoverRepos(workspace);
  assert.deepEqual(repos, []);
});

test('isWorkspaceRoot returns true for multi-repo dir without own .git', () => {
  const workspace = makeTempWorkspace();
  fs.mkdirSync(path.join(workspace, 'a', '.git'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'b', '.git'), { recursive: true });

  assert.equal(isWorkspaceRoot(workspace), true);
});

test('isWorkspaceRoot returns false when dir has its own .git', () => {
  const workspace = makeTempWorkspace();
  fs.mkdirSync(path.join(workspace, '.git'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'a', '.git'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'b', '.git'), { recursive: true });

  assert.equal(isWorkspaceRoot(workspace), false);
});

test('isWorkspaceRoot returns false when fewer than 2 repos', () => {
  const workspace = makeTempWorkspace();
  fs.mkdirSync(path.join(workspace, 'only-one', '.git'), { recursive: true });

  assert.equal(isWorkspaceRoot(workspace), false);
});
