import net from 'node:net';

export interface HealthRetryOptions {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  dryRun?: boolean;
}

export interface HealthCheckResult {
  name: string;
  ok: boolean;
  attempts: number;
  detail: string;
  statusCode?: number;
  error?: string;
  skipped?: boolean;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRIES = 15;
const DEFAULT_RETRY_DELAY_MS = 2_000;

function normalizeOptions(options?: HealthRetryOptions) {
  return {
    timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retries: options?.retries ?? DEFAULT_RETRIES,
    retryDelayMs: options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    dryRun: options?.dryRun ?? false,
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryCheck(
  name: string,
  options: HealthRetryOptions,
  check: (timeoutMs: number) => Promise<HealthCheckResult>,
): Promise<HealthCheckResult> {
  const normalized = normalizeOptions(options);

  if (normalized.dryRun) {
    return {
      name,
      ok: true,
      attempts: 0,
      detail: 'skipped in dry-run mode',
      skipped: true,
    };
  }

  let lastFailure: HealthCheckResult | null = null;

  for (let attempt = 1; attempt <= normalized.retries; attempt += 1) {
    const result = await check(normalized.timeoutMs);
    if (result.ok) {
      return {
        ...result,
        attempts: attempt,
      };
    }

    lastFailure = {
      ...result,
      attempts: attempt,
    };

    if (attempt < normalized.retries) {
      await wait(normalized.retryDelayMs);
    }
  }

  return (
    lastFailure ?? {
      name,
      ok: false,
      attempts: normalized.retries,
      detail: 'health check failed without details',
    }
  );
}

export async function checkHttpHealth(
  name: string,
  url: string,
  options?: HealthRetryOptions,
): Promise<HealthCheckResult> {
  return retryCheck(name, options ?? {}, async (timeoutMs) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });

      if (response.ok) {
        return {
          name,
          ok: true,
          detail: `HTTP ${response.status} from ${url}`,
          statusCode: response.status,
          attempts: 1,
        };
      }

      return {
        name,
        ok: false,
        detail: `HTTP ${response.status} from ${url}`,
        statusCode: response.status,
        attempts: 1,
      };
    } catch (error: unknown) {
      return {
        name,
        ok: false,
        detail: `failed to reach ${url}`,
        error: error instanceof Error ? error.message : String(error),
        attempts: 1,
      };
    } finally {
      clearTimeout(timer);
    }
  });
}

export async function checkTcpHealth(
  name: string,
  host: string,
  port: number,
  options?: HealthRetryOptions,
): Promise<HealthCheckResult> {
  return retryCheck(name, options ?? {}, async (timeoutMs) => {
    const connection = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      let resolved = false;
      const socket = net.createConnection({ host, port });

      const settle = (result: { ok: boolean; error?: string }) => {
        if (resolved) {
          return;
        }

        resolved = true;
        clearTimeout(timeout);
        resolve(result);
      };

      const timeout = setTimeout(() => {
        socket.destroy();
        settle({ ok: false, error: `timeout after ${timeoutMs}ms` });
      }, timeoutMs);

      socket.once('connect', () => {
        socket.end();
        settle({ ok: true });
      });

      socket.once('error', (error) => {
        socket.destroy();
        settle({ ok: false, error: error.message });
      });
    });

    if (connection.ok) {
      return {
        name,
        ok: true,
        detail: `TCP ${host}:${port} reachable`,
        attempts: 1,
      };
    }

    return {
      name,
      ok: false,
      detail: `TCP ${host}:${port} unreachable`,
      error: connection.error,
      attempts: 1,
    };
  });
}
