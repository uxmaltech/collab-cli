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
  deriveWorkspaceName,
  detectWorkspaceLayout,
  loadCollabConfig,
} = await import('../../dist/lib/config.js');

const {
  scopedComposeDefaults,
  COMPOSE_ENV_DEFAULTS,
} = await import('../../dist/lib/compose-defaults.js');

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

test('isWorkspaceRoot returns true with a single child repo', () => {
  const workspace = makeTempWorkspace();
  fs.mkdirSync(path.join(workspace, 'only-one', '.git'), { recursive: true });

  assert.equal(isWorkspaceRoot(workspace), true);
});

// ────────────────────────────────────────────────────────────────
// deriveWorkspaceName
// ────────────────────────────────────────────────────────────────

test('deriveWorkspaceName slugifies directory basename', () => {
  assert.equal(deriveWorkspaceName('/home/user/My Project'), 'my-project');
  assert.equal(deriveWorkspaceName('/tmp/ecommerce'), 'ecommerce');
  assert.equal(deriveWorkspaceName('/tmp/Some--Weird___Name'), 'some-weird-name');
});

test('deriveWorkspaceName returns "workspace" for empty-ish names', () => {
  assert.equal(deriveWorkspaceName('/'), 'workspace');
});

// ────────────────────────────────────────────────────────────────
// detectWorkspaceLayout
// ────────────────────────────────────────────────────────────────

test('detectWorkspaceLayout returns mono-repo when dir is a git repo', () => {
  const workspace = makeTempWorkspace();
  fs.mkdirSync(path.join(workspace, '.git'), { recursive: true });

  const layout = detectWorkspaceLayout(workspace);
  assert.deepEqual(layout, { type: 'mono-repo', repos: ['.'] });
});

test('detectWorkspaceLayout returns multi-repo with 2+ child repos', () => {
  const workspace = makeTempWorkspace();
  fs.mkdirSync(path.join(workspace, 'api', '.git'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'web', '.git'), { recursive: true });

  const layout = detectWorkspaceLayout(workspace);
  assert.equal(layout.type, 'multi-repo');
  assert.deepEqual(layout.repos, ['api', 'web']);
});

test('detectWorkspaceLayout returns mono-repo with exactly 1 child repo', () => {
  const workspace = makeTempWorkspace();
  fs.mkdirSync(path.join(workspace, 'app', '.git'), { recursive: true });

  const layout = detectWorkspaceLayout(workspace);
  assert.deepEqual(layout, { type: 'mono-repo', repos: ['app'] });
});

test('detectWorkspaceLayout returns null when no repos found', () => {
  const workspace = makeTempWorkspace();
  fs.mkdirSync(path.join(workspace, 'plain-dir'), { recursive: true });

  assert.equal(detectWorkspaceLayout(workspace), null);
});

// ────────────────────────────────────────────────────────────────
// Backward compatibility: loadCollabConfig with old workspace format
// ────────────────────────────────────────────────────────────────

test('loadCollabConfig migrates old workspace config without name/type', () => {
  const workspace = makeTempWorkspace();
  const collabDir = path.join(workspace, '.collab');
  fs.mkdirSync(collabDir, { recursive: true });

  // Old format: repos-only, no name or type
  const oldConfig = { mode: 'file-only', workspace: { repos: ['api', 'web'] }, compose: {} };
  fs.writeFileSync(path.join(collabDir, 'config.json'), JSON.stringify(oldConfig));

  const config = loadCollabConfig(workspace);

  assert.ok(config.workspace, 'workspace should be defined');
  assert.equal(config.workspace.repos.length, 2);
  assert.equal(config.workspace.type, 'multi-repo');
  assert.ok(config.workspace.name, 'name should be derived');
});

test('loadCollabConfig preserves full workspace config with name/type', () => {
  const workspace = makeTempWorkspace();
  const collabDir = path.join(workspace, '.collab');
  fs.mkdirSync(collabDir, { recursive: true });

  const fullConfig = {
    mode: 'file-only',
    workspace: { name: 'analytics', type: 'mono-repo', repos: ['.'] },
    compose: { projectName: 'collab-analytics' },
  };
  fs.writeFileSync(path.join(collabDir, 'config.json'), JSON.stringify(fullConfig));

  const config = loadCollabConfig(workspace);

  assert.equal(config.workspace.name, 'analytics');
  assert.equal(config.workspace.type, 'mono-repo');
  assert.deepEqual(config.workspace.repos, ['.']);
  assert.equal(config.compose.projectName, 'collab-analytics');
});

test('loadCollabConfig backfills compose.projectName from migrated workspace', () => {
  const workspace = makeTempWorkspace();
  const collabDir = path.join(workspace, '.collab');
  fs.mkdirSync(collabDir, { recursive: true });

  // Old format: workspace repos but no compose.projectName
  const oldConfig = { mode: 'file-only', workspace: { repos: ['api', 'web'] }, compose: {} };
  fs.writeFileSync(path.join(collabDir, 'config.json'), JSON.stringify(oldConfig));

  const config = loadCollabConfig(workspace);

  assert.ok(config.compose.projectName, 'projectName should be backfilled');
  assert.ok(
    config.compose.projectName.startsWith('collab-'),
    `projectName should start with "collab-", got "${config.compose.projectName}"`,
  );
});

test('loadCollabConfig handles invalid repos entries gracefully', () => {
  const workspace = makeTempWorkspace();
  const collabDir = path.join(workspace, '.collab');
  fs.mkdirSync(collabDir, { recursive: true });

  // Corrupt repos: contains non-string values
  const badConfig = { mode: 'file-only', workspace: { repos: [42, null, 'valid'] }, compose: {} };
  fs.writeFileSync(path.join(collabDir, 'config.json'), JSON.stringify(badConfig));

  const config = loadCollabConfig(workspace);

  assert.ok(config.workspace, 'workspace should be defined');
  assert.deepEqual(config.workspace.repos, ['valid']);
  assert.equal(config.workspace.type, 'mono-repo');
});

test('loadCollabConfig returns no workspace for empty repos array', () => {
  const workspace = makeTempWorkspace();
  const collabDir = path.join(workspace, '.collab');
  fs.mkdirSync(collabDir, { recursive: true });

  const emptyConfig = { mode: 'file-only', workspace: { repos: [] }, compose: {} };
  fs.writeFileSync(path.join(collabDir, 'config.json'), JSON.stringify(emptyConfig));

  const config = loadCollabConfig(workspace);

  assert.equal(config.workspace, undefined, 'workspace should be undefined for empty repos');
  assert.equal(config.compose.projectName, undefined, 'projectName should be undefined without workspace');
});

// ────────────────────────────────────────────────────────────────
// scopedComposeDefaults
// ────────────────────────────────────────────────────────────────

test('scopedComposeDefaults prefixes resource names with workspace slug', () => {
  const scoped = scopedComposeDefaults('ecommerce');

  assert.equal(scoped.COLLAB_NETWORK, 'collab-ecommerce-network');
  assert.equal(scoped.QDRANT_VOLUME, 'collab-ecommerce-qdrant-data');
  assert.equal(scoped.NEBULA_METAD_VOLUME, 'collab-ecommerce-nebula-metad0');
  assert.equal(scoped.NEBULA_STORAGED_VOLUME, 'collab-ecommerce-nebula-storaged0');
  assert.equal(scoped.MCP_VOLUME, 'collab-ecommerce-mcp-data');
});

test('scopedComposeDefaults inherits non-resource defaults', () => {
  const scoped = scopedComposeDefaults('test');

  // Non-resource defaults remain unchanged
  assert.equal(scoped.QDRANT_PORT, COMPOSE_ENV_DEFAULTS.QDRANT_PORT);
  assert.equal(scoped.MCP_IMAGE, COMPOSE_ENV_DEFAULTS.MCP_IMAGE);
  assert.equal(scoped.NEBULA_VERSION, COMPOSE_ENV_DEFAULTS.NEBULA_VERSION);
});

test('scopedComposeDefaults handles slugification of special characters', () => {
  const scoped = scopedComposeDefaults('My Cool Project!');
  assert.equal(scoped.COLLAB_NETWORK, 'collab-my-cool-project-network');
});
