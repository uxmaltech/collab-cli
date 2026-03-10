import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

import { makeTempWorkspace } from '../helpers/workspace.mjs';

const require = createRequire(import.meta.url);
const { defaultCollabConfig, loadCollabConfig } = require('../../dist/lib/config.js');

test('loadCollabConfig returns defaults when config file does not exist', () => {
  const workspace = makeTempWorkspace();
  const config = loadCollabConfig(workspace);

  assert.equal(config.workspaceDir, workspace);
  assert.equal(config.mode, 'file-only');
  assert.equal(config.envFile, path.join(workspace, '.env'));
});

test('loadCollabConfig reads and applies mode/env overrides', () => {
  const workspace = makeTempWorkspace();
  const defaults = defaultCollabConfig(workspace);
  fs.mkdirSync(defaults.collabDir, { recursive: true });
  fs.writeFileSync(
    defaults.configFile,
    JSON.stringify(
      {
        mode: 'indexed',
        envFile: 'config/.env.custom',
        compose: {
          consolidatedFile: 'compose/all.yml',
        },
      },
      null,
      2,
    ),
  );

  const loaded = loadCollabConfig(workspace);
  assert.equal(loaded.mode, 'indexed');
  assert.equal(loaded.envFile, path.join(workspace, 'config/.env.custom'));
  assert.equal(loaded.compose.consolidatedFile, 'compose/all.yml');
});

test('loadCollabConfig fails fast on invalid persisted mode', () => {
  const workspace = makeTempWorkspace();
  const defaults = defaultCollabConfig(workspace);
  fs.mkdirSync(defaults.collabDir, { recursive: true });
  fs.writeFileSync(defaults.configFile, JSON.stringify({ mode: '' }, null, 2));

  assert.throws(() => loadCollabConfig(workspace), /Invalid mode/);
});

test('loadCollabConfig reads github config', () => {
  const workspace = makeTempWorkspace();
  const defaults = defaultCollabConfig(workspace);
  fs.mkdirSync(defaults.collabDir, { recursive: true });
  fs.writeFileSync(
    defaults.configFile,
    JSON.stringify({
      github: {
        requiredApprovals: 2,
        enforceAdmins: true,
        requiredStatusChecks: ['ci/build'],
      },
    }, null, 2),
  );

  const loaded = loadCollabConfig(workspace);
  assert.equal(loaded.github.requiredApprovals, 2);
  assert.equal(loaded.github.enforceAdmins, true);
  assert.deepEqual(loaded.github.requiredStatusChecks, ['ci/build']);
});

test('loadCollabConfig defaults github to undefined when not set', () => {
  const workspace = makeTempWorkspace();
  const config = loadCollabConfig(workspace);
  assert.equal(config.github, undefined);
});
