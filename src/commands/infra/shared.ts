import path from 'node:path';

import type { CollabConfig } from '../../lib/config';
import type { ComposeRunOptions, ComposeServiceSelection } from '../../lib/compose-paths';
import { getComposeFilePaths, selectInfraComposeFile } from '../../lib/compose-paths';
import { runDockerCompose } from '../../lib/docker-compose';
import { CliError } from '../../lib/errors';
import type { Executor } from '../../lib/executor';
import type { Logger } from '../../lib/logger';
import { ensureCommandAvailable, ensureFileExists } from '../../lib/preconditions';
import {
  dryRunHealthOptions,
  loadRuntimeEnv,
  logServiceHealth,
  waitForInfraHealth,
} from '../../lib/service-health';
import { startSpinner } from '../../lib/spinner';

export const INFRA_SERVICES = ['qdrant', 'metad0', 'storaged0', 'graphd'] as const;

/** @deprecated Use {@link ComposeServiceSelection} directly. */
export type InfraSelection = ComposeServiceSelection;

/** @deprecated Use {@link ComposeRunOptions} directly. */
export type InfraRunOptions = ComposeRunOptions;

/**
 * Resolves the compose file to use for infrastructure services.
 * Prefers an explicit `--file` flag, then falls back to compose-paths resolution.
 */
export function resolveInfraComposeFile(
  config: CollabConfig,
  outputDirectory: string | undefined,
  explicitFile: string | undefined,
): ComposeServiceSelection {
  if (explicitFile) {
    const filePath = path.resolve(config.workspaceDir, explicitFile);
    return { filePath, source: 'split' };
  }

  const paths = getComposeFilePaths(config, outputDirectory);
  const selected = selectInfraComposeFile(paths);

  return {
    filePath: selected.file,
    source: selected.source,
  };
}

/**
 * Runs a docker compose action for infrastructure services (Qdrant, NebulaGraph).
 * When the action is `'up'`, waits for health checks to pass.
 */
export async function runInfraCompose(
  logger: Logger,
  executor: Executor,
  config: CollabConfig,
  selection: ComposeServiceSelection,
  action: 'up' | 'stop' | 'ps',
  options: ComposeRunOptions = {},
): Promise<void> {
  ensureCommandAvailable('docker', { dryRun: executor.dryRun });
  if (!executor.dryRun) {
    ensureFileExists(selection.filePath, 'Compose file');
  }

  const args = action === 'up' ? ['up', '-d'] : action === 'stop' ? ['stop'] : ['ps'];
  const services = selection.source === 'consolidated' ? [...INFRA_SERVICES] : [];

  const spinner = action === 'up'
    ? await startSpinner('Starting infrastructure...', logger.verbosity === 'quiet')
    : null;

  runDockerCompose({
    executor,
    files: [selection.filePath],
    arguments: [...args, ...services],
    cwd: config.workspaceDir,
    projectName: config.compose.projectName,
  });

  if (action !== 'up') {
    return;
  }

  spinner?.message('Waiting for services to be healthy...');

  const env = loadRuntimeEnv(config);
  const health = await waitForInfraHealth(env, dryRunHealthOptions(executor, options.health ?? {}));

  if (health.ok) {
    spinner?.stop('Infrastructure services healthy');
  } else {
    spinner?.fail('Infrastructure services did not become healthy');
  }

  logServiceHealth(logger, 'infra health', health);

  if (!health.ok) {
    throw new CliError('Infrastructure services did not become healthy in time.');
  }
}
