import type { CollabConfig } from './config';
import { COMPOSE_ENV_DEFAULTS } from './compose-defaults';
import { readEnvFile, mergeEnvWithDefaults, type EnvMap } from './env-file';
import type { Executor } from './executor';
import { checkHttpHealth, checkTcpHealth, type HealthRetryOptions } from './health-checker';
import type { Logger } from './logger';

export type ServiceHealthOptions = HealthRetryOptions;

export interface ServiceHealthSummary {
  ok: boolean;
  checks: string[];
  errors: string[];
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 65_535) {
    return fallback;
  }

  return parsed;
}

export function loadRuntimeEnv(config: CollabConfig): EnvMap {
  const existing = readEnvFile(config.envFile);
  return mergeEnvWithDefaults(existing, COMPOSE_ENV_DEFAULTS);
}

export async function waitForInfraHealth(
  env: EnvMap,
  options: ServiceHealthOptions,
): Promise<ServiceHealthSummary> {
  const qdrantHost = env.QDRANT_HOST || '127.0.0.1';
  const qdrantPort = parsePort(env.QDRANT_PORT, 6333);

  const nebulaHost = env.NEBULA_HOST || '127.0.0.1';
  const nebulaPort = parsePort(env.NEBULA_GRAPHD_PORT, 9669);

  const qdrant = await checkHttpHealth('qdrant', `http://${qdrantHost}:${qdrantPort}/collections`, options);
  const nebula = await checkTcpHealth('nebula-graphd', nebulaHost, nebulaPort, options);

  const checks = [qdrant, nebula];

  return {
    ok: checks.every((item) => item.ok),
    checks: checks.filter((item) => item.ok).map((item) => item.detail),
    errors: checks
      .filter((item) => !item.ok)
      .map((item) => `${item.name}: ${item.error ?? item.detail}`),
  };
}

export async function waitForMcpHealth(
  env: EnvMap,
  options: ServiceHealthOptions,
): Promise<ServiceHealthSummary> {
  const host = env.MCP_HOST || '127.0.0.1';
  const port = parsePort(env.MCP_PORT, 7337);
  const mcp = await checkHttpHealth('mcp', `http://${host}:${port}/health`, options);

  return {
    ok: mcp.ok,
    checks: mcp.ok ? [mcp.detail] : [],
    errors: mcp.ok ? [] : [`${mcp.name}: ${mcp.error ?? mcp.detail}`],
  };
}

export function logServiceHealth(logger: Logger, title: string, summary: ServiceHealthSummary): void {
  if (summary.ok) {
    logger.result(`[PASS] ${title}`);
    for (const line of summary.checks) {
      logger.result(`       ${line}`);
    }
    return;
  }

  logger.result(`[FAIL] ${title}`);
  for (const line of summary.errors) {
    logger.result(`       ${line}`);
  }
}

export function dryRunHealthOptions(executor: Executor, options: ServiceHealthOptions): ServiceHealthOptions {
  return {
    ...options,
    dryRun: executor.dryRun,
  };
}
