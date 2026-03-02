import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import test from 'node:test';
import { once } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { checkHttpHealth, checkTcpHealth } = require('../../dist/lib/health-checker.js');

async function startHttpServer(statusCode = 200) {
  const server = http.createServer((_req, res) => {
    res.writeHead(statusCode, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: statusCode === 200 }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

async function startTcpServer() {
  const server = net.createServer((socket) => {
    socket.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

test('checkHttpHealth returns ok for healthy endpoint', async () => {
  const server = await startHttpServer(200);
  const address = server.address();
  try {
    const result = await checkHttpHealth('health', `http://127.0.0.1:${address.port}/health`, {
      retries: 1,
      timeoutMs: 1_000,
      retryDelayMs: 0,
    });
    assert.equal(result.ok, true);
    assert.equal(result.statusCode, 200);
  } finally {
    server.close();
  }
});

test('checkHttpHealth returns failure for non-2xx responses', async () => {
  const server = await startHttpServer(503);
  const address = server.address();
  try {
    const result = await checkHttpHealth('health', `http://127.0.0.1:${address.port}/health`, {
      retries: 1,
      timeoutMs: 1_000,
      retryDelayMs: 0,
    });
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 503);
  } finally {
    server.close();
  }
});

test('checkTcpHealth returns ok for reachable endpoint', async () => {
  const server = await startTcpServer();
  const address = server.address();
  try {
    const result = await checkTcpHealth('tcp', '127.0.0.1', address.port, {
      retries: 1,
      timeoutMs: 1_000,
      retryDelayMs: 0,
    });
    assert.equal(result.ok, true);
  } finally {
    server.close();
  }
});

test('checkTcpHealth supports dry-run skip mode', async () => {
  const result = await checkTcpHealth('tcp', '127.0.0.1', 65530, {
    dryRun: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
});
