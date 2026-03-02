import type { Executor } from './executor';
import { CliError } from './errors';
import type { Logger } from './logger';
import { resolveCommandPath } from './shell';

export interface PreflightCheckResult {
  id: string;
  ok: boolean;
  detail: string;
  fix: string;
}

function commandCheck(
  commandName: string,
  fix: string,
  executor: Executor,
): PreflightCheckResult {
  const resolved = resolveCommandPath(commandName);
  if (!resolved) {
    return {
      id: commandName,
      ok: false,
      detail: `${commandName} not found in PATH`,
      fix,
    };
  }

  const version = executor.run(commandName, ['--version'], { check: false, verboseOnly: true });

  return {
    id: commandName,
    ok: true,
    detail: version.stdout.trim() || version.stderr.trim() || `found at ${resolved}`,
    fix,
  };
}

function dockerComposeCheck(executor: Executor): PreflightCheckResult {
  const dockerResolved = resolveCommandPath('docker');
  if (!dockerResolved) {
    return {
      id: 'docker-compose-plugin',
      ok: false,
      detail: 'docker command not found; cannot verify compose plugin',
      fix: 'Install Docker Desktop or Docker Engine with compose plugin.',
    };
  }

  const version = executor.run('docker', ['compose', 'version'], { check: false, verboseOnly: true });
  const output = `${version.stdout}\n${version.stderr}`.trim();

  if (version.status === 0) {
    return {
      id: 'docker-compose-plugin',
      ok: true,
      detail: output || 'docker compose plugin available',
      fix: 'Install Docker Compose plugin.',
    };
  }

  return {
    id: 'docker-compose-plugin',
    ok: false,
    detail: output || 'docker compose plugin unavailable',
    fix: 'Install Docker Compose plugin and verify with: docker compose version',
  };
}

export function runPreflightChecks(executor: Executor): PreflightCheckResult[] {
  const results: PreflightCheckResult[] = [];

  results.push(
    commandCheck('node', 'Install Node.js >= 20.', executor),
    commandCheck('npm', 'Install npm >= 10 (bundled with modern Node.js).', executor),
    commandCheck('python3', 'Install Python 3 (used by ingestion and tooling).', executor),
    commandCheck('docker', 'Install Docker Desktop or Docker Engine.', executor),
    dockerComposeCheck(executor),
  );

  return results;
}

export function assertPreflightChecks(results: readonly PreflightCheckResult[], logger: Logger): void {
  const failed = results.filter((item) => !item.ok);

  for (const item of results) {
    const prefix = item.ok ? '[PASS]' : '[FAIL]';
    logger.result(`${prefix} ${item.id}: ${item.detail}`);
    if (!item.ok) {
      logger.result(`       fix: ${item.fix}`);
    }
  }

  if (failed.length > 0) {
    throw new CliError(`Preflight failed with ${failed.length} issue(s).`);
  }
}
