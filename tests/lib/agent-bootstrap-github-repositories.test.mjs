import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createBufferedLogger } from '../helpers/test-context.mjs';

const {
  extractGitHubRepositoryReferences,
  pickBirthRepositoriesFromGitHub,
  validateGitHubRepositoryReferences,
} = await import('../../dist/lib/agent-bootstrap/github-repositories.js');

function writeGitHubAuth(collabDir) {
  fs.mkdirSync(collabDir, { recursive: true });
  fs.writeFileSync(
    path.join(collabDir, 'github-auth.json'),
    JSON.stringify(
      {
        provider: 'github',
        token: 'test-token',
        scopes: ['repo'],
        created_at: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
}

test('pickBirthRepositoriesFromGitHub selects self and assigned repositories from GitHub results', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-agent-birth-'));
  const collabDir = path.join(workspace, '.collab');
  const logs = [];
  writeGitHubAuth(collabDir);

  const queries = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const href = String(url);

    if (href === 'https://api.github.com/user') {
      return {
        ok: true,
        status: 200,
        text: async () => '',
      };
    }

    if (href.includes('api.github.com/search/repositories')) {
      const parsed = new URL(href);
      const query = parsed.searchParams.get('q');
      queries.push(query);

      if (query === 'iot-agent') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            total_count: 2,
            items: [
              {
                full_name: 'anystream/iot-development-agent',
                description: 'Agent repo',
                private: true,
                default_branch: 'main',
              },
              {
                full_name: 'anystream/other-agent',
                description: 'Other repo',
                private: false,
                default_branch: 'main',
              },
            ],
          }),
        };
      }

      if (query === 'anystream') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            total_count: 3,
            items: [
              {
                full_name: 'anystream/iot-development-agent',
                description: 'Agent repo',
                private: true,
                default_branch: 'main',
              },
              {
                full_name: 'anystream/iot-platform',
                description: 'Platform repo',
                private: true,
                default_branch: 'main',
              },
              {
                full_name: 'anystream/iot-firmware',
                description: 'Firmware repo',
                private: true,
                default_branch: 'main',
              },
            ],
          }),
        };
      }
    }

    throw new Error(`Unexpected fetch: ${href}`);
  });

  const selection = await pickBirthRepositoriesFromGitHub({
    collabDir,
    logger: createBufferedLogger(logs),
    prompt: {
      async text(question, defaultValue) {
        if (question === 'Search GitHub repositories for the agent self repository') {
          assert.equal(defaultValue, undefined);
          return 'iot-agent';
        }
        if (question === 'Search GitHub repositories for assigned work') {
          assert.equal(defaultValue, 'anystream');
          return 'anystream';
        }
        throw new Error(`Unexpected text prompt: ${question}`);
      },
      async choice(question) {
        if (question === 'Select self repository') {
          return 'anystream/iot-development-agent';
        }
        if (question === 'Assign additional repositories from GitHub?') {
          return 'yes';
        }
        if (question === 'Add more assigned repositories?') {
          return 'no';
        }
        throw new Error(`Unexpected choice prompt: ${question}`);
      },
      async multiSelect(question) {
        assert.equal(question, 'Select assigned repositories');
        return ['anystream/iot-platform', 'anystream/iot-firmware'];
      },
    },
  });

  assert.equal(selection.selfRepository, 'anystream/iot-development-agent');
  assert.deepEqual(selection.assignedRepositories, [
    'anystream/iot-platform',
    'anystream/iot-firmware',
  ]);
  assert.deepEqual(queries, ['iot-agent', 'anystream']);
});

test('extractGitHubRepositoryReferences normalizes GitHub URLs and owner/repo slugs', () => {
  const references = extractGitHubRepositoryReferences(
    'Use https://github.com/anystream/iot-websocket-relay and anystream/balena-ws-player, but ignore github.com/docs.',
  );

  assert.deepEqual(references, [
    'anystream/iot-websocket-relay',
    'anystream/balena-ws-player',
  ]);
});

test('validateGitHubRepositoryReferences keeps only repositories that resolve via the GitHub API', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-agent-birth-validate-'));
  const collabDir = path.join(workspace, '.collab');

  t.mock.method(globalThis, 'fetch', async (url) => {
    const href = String(url);
    if (href.endsWith('/repos/anystream/iot-websocket-relay')) {
      return { ok: true, status: 200 };
    }
    if (href.endsWith('/repos/anystream/missing-repo')) {
      return { ok: false, status: 404 };
    }
    throw new Error(`Unexpected fetch: ${href}`);
  });

  const valid = await validateGitHubRepositoryReferences(
    ['anystream/iot-websocket-relay', 'anystream/missing-repo'],
    collabDir,
  );

  assert.deepEqual(valid, ['anystream/iot-websocket-relay']);
});
