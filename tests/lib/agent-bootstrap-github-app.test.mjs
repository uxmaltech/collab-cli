import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const {
  GitHubAppValidationError,
  validateGitHubAppIdentity,
} = await import('../../dist/lib/agent-bootstrap/github-app.js');

function createJsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function writePrivateKeyPem(t) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-gh-app-'));
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKeyPath = path.join(tempDir, 'github-app.pem');
  fs.writeFileSync(
    privateKeyPath,
    privateKey.export({ type: 'pkcs1', format: 'pem' }),
    'utf8',
  );
  return privateKeyPath;
}

test('validateGitHubAppIdentity validates the installation and repository access', async (t) => {
  const privateKeyPath = writePrivateKeyPem(t);
  const seen = [];

  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const pathname = new URL(String(url)).pathname;
    seen.push({ pathname, auth: options.headers?.Authorization });

    if (pathname === '/app') {
      return createJsonResponse(200, {
        id: 123456,
        slug: 'iot-development-agent',
      });
    }

    if (pathname === '/app/installations/999999') {
      return createJsonResponse(200, {
        id: 999999,
        account: {
          login: 'anystream',
          type: 'Organization',
        },
      });
    }

    if (pathname === '/app/installations/999999/access_tokens') {
      return createJsonResponse(201, {
        token: 'installation-token',
      });
    }

    if (pathname === '/repos/anystream/iot-development-agent') {
      return createJsonResponse(200, { full_name: 'anystream/iot-development-agent' });
    }

    if (pathname === '/repos/anystream/balena-ws-player') {
      return createJsonResponse(200, { full_name: 'anystream/balena-ws-player' });
    }

    throw new Error(`unexpected fetch pathname: ${pathname}`);
  });

  const result = await validateGitHubAppIdentity({
    appId: '123456',
    installationId: '999999',
    owner: 'anystream',
    ownerType: 'auto',
    privateKeyPath,
    repositories: [
      'anystream/iot-development-agent',
      'anystream/balena-ws-player',
    ],
    cwd: process.cwd(),
  });

  assert.equal(result.owner, 'anystream');
  assert.equal(result.ownerType, 'org');
  assert.equal(result.privateKeyPath, privateKeyPath);
  assert.deepEqual(result.validatedRepositories, [
    'anystream/iot-development-agent',
    'anystream/balena-ws-player',
  ]);
  assert.deepEqual(
    seen.map((entry) => entry.pathname),
    [
      '/app',
      '/app/installations/999999',
      '/app/installations/999999/access_tokens',
      '/repos/anystream/iot-development-agent',
      '/repos/anystream/balena-ws-player',
    ],
  );
});

test('validateGitHubAppIdentity rejects an unreadable private key path', async () => {
  await assert.rejects(
    () =>
      validateGitHubAppIdentity({
        appId: '123456',
        installationId: '999999',
        owner: 'anystream',
        ownerType: 'auto',
        privateKeyPath: '/tmp/does-not-exist-github-app.pem',
        repositories: ['anystream/iot-development-agent'],
      }),
    (error) => {
      assert.ok(error instanceof GitHubAppValidationError);
      assert.equal(error.code, 'private_key_unreadable');
      assert.deepEqual(error.promptFields, ['githubAppPrivateKeyPath']);
      return true;
    },
  );
});

test('validateGitHubAppIdentity rejects installations owned by the wrong GitHub account', async (t) => {
  const privateKeyPath = writePrivateKeyPem(t);

  t.mock.method(globalThis, 'fetch', async (url) => {
    const pathname = new URL(String(url)).pathname;

    if (pathname === '/app') {
      return createJsonResponse(200, {
        id: 123456,
      });
    }

    if (pathname === '/app/installations/999999') {
      return createJsonResponse(200, {
        id: 999999,
        account: {
          login: 'uxmaltech',
          type: 'Organization',
        },
      });
    }

    throw new Error(`unexpected fetch pathname: ${pathname}`);
  });

  await assert.rejects(
    () =>
      validateGitHubAppIdentity({
        appId: '123456',
        installationId: '999999',
        owner: 'anystream',
        ownerType: 'auto',
        privateKeyPath,
        repositories: ['anystream/iot-development-agent'],
      }),
    (error) => {
      assert.ok(error instanceof GitHubAppValidationError);
      assert.equal(error.code, 'installation_owner_mismatch');
      assert.deepEqual(error.promptFields, ['githubAppInstallationId']);
      assert.match(error.message, /belongs to 'uxmaltech'/);
      return true;
    },
  );
});
