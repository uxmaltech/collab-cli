/**
 * Docker Compose container status parsing and display.
 * Parses `docker compose ps --format json` output, merges with health
 * check results, and renders a formatted status table.
 */

import { bold, dim, green, red, CHECK, CROSS } from './ansi';
import type { HealthCheckResult } from './health-checker';
import type { Logger } from './logger';

/** Raw container data parsed from `docker compose ps --format json`. */
export interface ContainerInfo {
  name: string;
  service: string;
  state: string;
  status: string;
  ports: string;
  health: string;
}

/** Merged service status combining container and health check data. */
export interface ServiceStatus {
  service: string;
  label: string;
  container?: string;
  running: boolean;
  status: string;
  ports: string;
  healthOk: boolean | null;
  healthDetail: string;
}

/** Human-readable labels for known Docker Compose services. */
export const SERVICE_LABELS: Record<string, string> = {
  qdrant: 'Qdrant (Vector DB)',
  metad0: 'NebulaGraph metad',
  storaged0: 'NebulaGraph storaged',
  graphd: 'NebulaGraph graphd',
  mcp: 'MCP Server',
};

/** Safely extracts a string value from a parsed JSON field. */
function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Parses the stdout of `docker compose ps --format json`.
 * Docker Compose V2 outputs one JSON object per line.
 * Skips malformed lines gracefully.
 */
export function parseComposePs(stdout: string): ContainerInfo[] {
  if (!stdout.trim()) {
    return [];
  }

  const lines = stdout.trim().split('\n');
  const containers: ContainerInfo[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const raw = JSON.parse(trimmed) as Record<string, unknown>;
      containers.push({
        name: str(raw['Name']) || str(raw['name']),
        service: str(raw['Service']) || str(raw['service']),
        state: str(raw['State']) || str(raw['state']),
        status: str(raw['Status']) || str(raw['status']),
        ports: str(raw['Ports']) || str(raw['ports']),
        health: str(raw['Health']) || str(raw['health']),
      });
    } catch {
      // Skip malformed JSON lines
    }
  }

  return containers;
}

/**
 * Simplifies Docker port mappings for display.
 * Converts "0.0.0.0:6333->6333/tcp" to "6333/tcp".
 */
function formatPorts(raw: string): string {
  if (!raw) {
    return '';
  }

  return raw
    .split(', ')
    .map((mapping) => {
      const arrow = mapping.indexOf('->');
      return arrow !== -1 ? mapping.slice(arrow + 2) : mapping;
    })
    .join(', ');
}

/**
 * Merges container info with health check results into a unified status list.
 * Services without running containers are shown as "Not running".
 * Health check results are matched by name to the service name.
 */
export function buildServiceStatusList(
  services: readonly string[],
  containers: readonly ContainerInfo[],
  healthResults: readonly HealthCheckResult[],
): ServiceStatus[] {
  const containerMap = new Map<string, ContainerInfo>();
  for (const c of containers) {
    containerMap.set(c.service, c);
  }

  const healthMap = new Map<string, HealthCheckResult>();
  for (const h of healthResults) {
    healthMap.set(h.name, h);
  }

  return services.map((service) => {
    const container = containerMap.get(service);
    const health = healthMap.get(service);
    const label = SERVICE_LABELS[service] ?? service;

    if (!container) {
      return {
        service,
        label,
        running: false,
        status: 'Not running',
        ports: '',
        healthOk: health ? health.ok : null,
        healthDetail: health?.detail ?? '',
      };
    }

    const running = container.state === 'running';

    return {
      service,
      label,
      container: container.name,
      running,
      status: container.status || container.state,
      ports: formatPorts(container.ports),
      healthOk: health ? health.ok : null,
      healthDetail: health?.detail ?? '',
    };
  });
}

/**
 * Renders a formatted status table to the terminal.
 * Each service shows its status, ports, and health check result.
 * A summary line at the bottom shows the overall running count.
 */
export function printStatusTable(
  logger: Logger,
  title: string,
  services: readonly ServiceStatus[],
  composePath?: string,
): void {
  const line = dim('\u2500'.repeat(48));

  logger.result('');
  logger.result(`  ${line}`);
  logger.result(`  ${bold(title)}`);
  logger.result(`  ${line}`);

  for (const svc of services) {
    logger.result('');
    logger.result(`  ${bold(svc.label)}`);

    const statusMarker = svc.running ? green(CHECK) : red(CROSS);
    logger.result(`    Status:  ${statusMarker} ${svc.status}`);

    if (svc.ports) {
      logger.result(`    Ports:   ${svc.ports}`);
    }

    if (svc.healthOk !== null) {
      const healthMarker = svc.healthOk ? green(CHECK) : red(CROSS);
      logger.result(`    Health:  ${healthMarker} ${svc.healthDetail}`);
    }
  }

  // Summary
  logger.result('');
  logger.result(`  ${line}`);

  const running = services.filter((s) => s.running).length;
  const total = services.length;
  const allUp = running === total;
  const summaryMarker = allUp ? green(CHECK) : red(CROSS);
  const summaryText = `${running}/${total} services running`;
  const composeNote = composePath ? ` | Compose: ${composePath}` : '';

  logger.result(`  ${summaryMarker} ${summaryText}${dim(composeNote)}`);
  logger.result('');
}
