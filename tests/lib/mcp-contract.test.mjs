import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import test from 'node:test';

import { probeMcpContract } from '../../dist/lib/mcp-contract.js';

function createHealthServer(body, statusCode = 200) {
  const server = http.createServer((_req, res) => {
    res.writeHead(statusCode, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  server.listen(0, '127.0.0.1');
  return server;
}

const VALID_HEALTH = {
  status: 'ok',
  version: '0.1.0',
  contractVersion: '1.0.0',
  dependencies: { qdrant: 'up', nebula: 'up' },
};

test('probeMcpContract returns health data for valid server', async () => {
  const server = createHealthServer(VALID_HEALTH);
  await once(server, 'listening');
  const addr = server.address();
  try {
    const result = await probeMcpContract(`http://127.0.0.1:${addr.port}`, {
      contractRange: '^1.0.0',
    });
    assert.equal(result.ok, true);
    assert.equal(result.skipped, false);
    assert.equal(result.health.version, '0.1.0');
    assert.equal(result.health.contractVersion, '1.0.0');
    assert.equal(result.contractCompatible, true);
    assert.deepEqual(result.health.dependencies, { qdrant: 'up', nebula: 'up' });
  } finally {
    server.close();
  }
});

test('probeMcpContract detects incompatible contract version', async () => {
  const server = createHealthServer({
    ...VALID_HEALTH,
    contractVersion: '0.5.0',
  });
  await once(server, 'listening');
  const addr = server.address();
  try {
    const result = await probeMcpContract(`http://127.0.0.1:${addr.port}`, {
      contractRange: '^1.0.0',
    });
    assert.equal(result.ok, true);
    assert.equal(result.contractCompatible, false);
  } finally {
    server.close();
  }
});

test('probeMcpContract skips contract check when no range given', async () => {
  const server = createHealthServer(VALID_HEALTH);
  await once(server, 'listening');
  const addr = server.address();
  try {
    const result = await probeMcpContract(`http://127.0.0.1:${addr.port}`);
    assert.equal(result.ok, true);
    assert.equal(result.contractCompatible, undefined);
  } finally {
    server.close();
  }
});

test('probeMcpContract fails for unreachable server', async () => {
  const result = await probeMcpContract('http://127.0.0.1:1', {
    timeoutMs: 1_000,
  });
  assert.equal(result.ok, false);
  assert.ok(result.error.includes('unreachable') || result.error.includes('not respond'),
    `Unexpected error: ${result.error}`);
});

test('probeMcpContract fails for invalid JSON body', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('not json');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address();
  try {
    const result = await probeMcpContract(`http://127.0.0.1:${addr.port}`);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('invalid JSON'), `Unexpected error: ${result.error}`);
  } finally {
    server.close();
  }
});

test('probeMcpContract fails for missing contract fields', async () => {
  const server = createHealthServer({ status: 'ok' });
  await once(server, 'listening');
  const addr = server.address();
  try {
    const result = await probeMcpContract(`http://127.0.0.1:${addr.port}`);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('unexpected structure'), `Unexpected error: ${result.error}`);
  } finally {
    server.close();
  }
});

test('probeMcpContract fails for non-2xx status', async () => {
  const server = createHealthServer({ error: 'internal' }, 500);
  await once(server, 'listening');
  const addr = server.address();
  try {
    const result = await probeMcpContract(`http://127.0.0.1:${addr.port}`);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('HTTP 500'), `Unexpected error: ${result.error}`);
  } finally {
    server.close();
  }
});

test('probeMcpContract skips in dry-run mode', async () => {
  const result = await probeMcpContract('http://127.0.0.1:1', { dryRun: true });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.health, undefined);
});
