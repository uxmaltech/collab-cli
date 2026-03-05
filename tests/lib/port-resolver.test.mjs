import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';

const { resolveAvailablePorts } = await import('../../dist/lib/port-resolver.js');

test('resolveAvailablePorts returns defaults when ports are free', async () => {
  const result = await resolveAvailablePorts({ qdrant: 18333, nebula: 18669, mcp: 18337 });

  // These high-numbered ports should be free
  assert.equal(result.qdrant, 18333);
  assert.equal(result.nebula, 18669);
  assert.equal(result.mcp, 18337);
});

test('resolveAvailablePorts increments when port is busy', async () => {
  // Bind a port to make it busy
  const server = net.createServer();
  await new Promise((resolve) => {
    server.listen(18444, '127.0.0.1', resolve);
  });

  try {
    const result = await resolveAvailablePorts({ qdrant: 18444, nebula: 18669, mcp: 18337 });

    // qdrant port should be incremented since 18444 is busy
    assert.ok(result.qdrant > 18444, `expected port > 18444, got ${result.qdrant}`);
    // others should stay at their defaults
    assert.equal(result.nebula, 18669);
    assert.equal(result.mcp, 18337);
  } finally {
    server.close();
  }
});
