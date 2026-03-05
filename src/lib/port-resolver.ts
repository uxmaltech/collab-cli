import net from 'node:net';

export interface PortDefaults {
  qdrant: number;
  nebula: number;
  mcp: number;
}

const DEFAULT_PORTS: PortDefaults = {
  qdrant: 6333,
  nebula: 9669,
  mcp: 7337,
};

/**
 * Tests whether a TCP port is available on 127.0.0.1.
 * Returns true if the port is free.
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Finds the next available port starting from `start`, incrementing by 1.
 * Tries up to 100 ports before giving up and returning the original.
 */
async function findAvailablePort(start: number): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  return start;
}

/**
 * Resolves available ports for Qdrant, NebulaGraph, and MCP.
 * If default ports are in use, automatically increments to find free ones.
 */
export async function resolveAvailablePorts(
  defaults: PortDefaults = DEFAULT_PORTS,
): Promise<PortDefaults> {
  const [qdrant, nebula, mcp] = await Promise.all([
    findAvailablePort(defaults.qdrant),
    findAvailablePort(defaults.nebula),
    findAvailablePort(defaults.mcp),
  ]);

  return { qdrant, nebula, mcp };
}
