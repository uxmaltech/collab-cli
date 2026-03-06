import semver from 'semver';

const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

/** Shape of the MCP /health endpoint response. */
export interface McpHealthResponse {
  status: string;
  version: string;
  contractVersion: string;
  dependencies: Record<string, string>;
}

/** Result of the contract validation probe. */
export interface McpContractProbeResult {
  ok: boolean;
  skipped: boolean;
  health?: McpHealthResponse;
  contractCompatible?: boolean;
  error?: string;
}

export interface McpContractProbeOptions {
  /** Timeout for the single HTTP probe in milliseconds. */
  timeoutMs?: number;
  /** Required contract version range (semver). */
  contractRange?: string;
  /** Skip the probe entirely (dry-run mode). */
  dryRun?: boolean;
}

/**
 * Probes the MCP server's /health endpoint once and validates
 * the response contract structure and version compatibility.
 *
 * This is a quick, single-attempt probe — not a retry loop.
 * Use it immediately after URL entry to give fast feedback.
 */
export async function probeMcpContract(
  baseUrl: string,
  options: McpContractProbeOptions = {},
): Promise<McpContractProbeResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const contractRange = options.contractRange;
  const dryRun = options.dryRun ?? false;

  if (dryRun) {
    return { ok: true, skipped: true };
  }

  const healthUrl = `${baseUrl}/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(healthUrl, {
      method: 'GET',
      signal: controller.signal,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        ok: false,
        skipped: false,
        error: `MCP server at ${baseUrl} did not respond within ${timeoutMs / 1000}s.`,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      skipped: false,
      error: `MCP server unreachable at ${baseUrl}: ${message}`,
    };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    return {
      ok: false,
      skipped: false,
      error: `MCP server returned HTTP ${response.status} at ${healthUrl}`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      skipped: false,
      error: `MCP server returned invalid JSON from ${healthUrl}`,
    };
  }

  if (!isValidHealthResponse(body)) {
    return {
      ok: false,
      skipped: false,
      error: 'MCP /health response has unexpected structure. Expected: { status, version, contractVersion, dependencies }',
    };
  }

  const health = body;

  let contractCompatible: boolean | undefined;
  if (contractRange) {
    contractCompatible = semver.satisfies(health.contractVersion, contractRange, {
      includePrerelease: true,
    });
  }

  return {
    ok: true,
    skipped: false,
    health,
    contractCompatible,
  };
}

/** Type guard for the expected /health response shape. */
function isValidHealthResponse(body: unknown): body is McpHealthResponse {
  if (typeof body !== 'object' || body === null) return false;

  const obj = body as Record<string, unknown>;
  return (
    typeof obj.status === 'string' &&
    typeof obj.version === 'string' &&
    typeof obj.contractVersion === 'string' &&
    typeof obj.dependencies === 'object' &&
    obj.dependencies !== null
  );
}
