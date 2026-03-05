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
 * Skips ports already claimed in `reserved` to avoid collisions when
 * multiple services are resolved in the same run.
 * Throws if no port is found within 100 attempts.
 */
async function findAvailablePort(
  start: number,
  reserved: Set<number>,
): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    if (reserved.has(port)) continue;
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(
    `No available port found in range ${start}–${start + 99}`,
  );
}

/**
 * Resolves available ports for Qdrant, NebulaGraph, and MCP.
 * If default ports are in use, automatically increments to find free ones.
 * Ports are resolved sequentially to avoid assigning the same port to
 * multiple services.
 */
export async function resolveAvailablePorts(
  defaults: PortDefaults = DEFAULT_PORTS,
): Promise<PortDefaults> {
  const reserved = new Set<number>();

  const qdrant = await findAvailablePort(defaults.qdrant, reserved);
  reserved.add(qdrant);

  const nebula = await findAvailablePort(defaults.nebula, reserved);
  reserved.add(nebula);

  const mcp = await findAvailablePort(defaults.mcp, reserved);

  return { qdrant, nebula, mcp };
}
