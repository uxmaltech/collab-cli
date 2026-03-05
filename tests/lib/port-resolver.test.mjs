import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';

const { resolveAvailablePorts } = await import('../../dist/lib/port-resolver.js');

/**
 * Binds an ephemeral port (OS-assigned) and returns the server + port.
 * This avoids hardcoding port numbers that may be in use.
 */
async function reserveFreePort() {
  const server = net.createServer();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  return { server, port };
}

test('resolveAvailablePorts returns defaults when ports are free', async () => {
  // Use ephemeral ports as "defaults" — they were free when we asked
  const { server: s1, port: p1 } = await reserveFreePort();
  const { server: s2, port: p2 } = await reserveFreePort();
  const { server: s3, port: p3 } = await reserveFreePort();

  // Release them so the resolver can bind-test successfully
  await Promise.all([
    new Promise((r) => s1.close(r)),
    new Promise((r) => s2.close(r)),
    new Promise((r) => s3.close(r)),
  ]);

  const result = await resolveAvailablePorts({ qdrant: p1, nebula: p2, mcp: p3 });

  assert.equal(result.qdrant, p1);
  assert.equal(result.nebula, p2);
  assert.equal(result.mcp, p3);
});

test('resolveAvailablePorts increments when port is busy', async () => {
  // Bind an ephemeral port and keep it busy
  const { server, port: busyPort } = await reserveFreePort();

  try {
    const result = await resolveAvailablePorts({ qdrant: busyPort, nebula: busyPort + 100, mcp: busyPort + 200 });

    // qdrant port should be incremented since busyPort is occupied
    assert.ok(result.qdrant > busyPort, `expected port > ${busyPort}, got ${result.qdrant}`);
    // others should resolve to their defaults (different range, no collision)
    assert.equal(result.nebula, busyPort + 100);
    assert.equal(result.mcp, busyPort + 200);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
