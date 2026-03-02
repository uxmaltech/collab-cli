import path from 'node:path';

import type { CollabConfig } from '../../lib/config';
import type { Executor } from '../../lib/executor';
import { CliError } from '../../lib/errors';
import type { Logger } from '../../lib/logger';
import { ensureCommandAvailable, ensureFileExists } from '../../lib/preconditions';
import { getComposeFilePaths, selectInfraComposeFile } from '../../lib/compose-paths';
import { runDockerCompose } from '../../lib/docker-compose';
import {
  dryRunHealthOptions,
  loadRuntimeEnv,
  logServiceHealth,
  waitForInfraHealth,
  type ServiceHealthOptions,
} from '../../lib/service-health';

export const INFRA_SERVICES = ['qdrant', 'metad0', 'storaged0', 'graphd'] as const;

export interface InfraSelection {
  filePath: string;
  source: 'consolidated' | 'split';
}

export interface InfraRunOptions {
  health?: ServiceHealthOptions;
}

export function resolveInfraComposeFile(
  config: CollabConfig,
  outputDirectory: string | undefined,
  explicitFile: string | undefined,
): InfraSelection {
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

export async function runInfraCompose(
  logger: Logger,
  executor: Executor,
  config: CollabConfig,
  selection: InfraSelection,
  action: 'up' | 'stop' | 'ps',
  options: InfraRunOptions = {},
): Promise<void> {
  ensureCommandAvailable('docker', { dryRun: executor.dryRun });
  ensureFileExists(selection.filePath, 'Compose file');

  const args = action === 'up' ? ['up', '-d'] : action === 'stop' ? ['stop'] : ['ps'];
  const services = selection.source === 'consolidated' ? [...INFRA_SERVICES] : [];

  runDockerCompose({
    executor,
    files: [selection.filePath],
    arguments: [...args, ...services],
    cwd: config.workspaceDir,
  });

  if (action !== 'up') {
    return;
  }

  const env = loadRuntimeEnv(config);
  const health = await waitForInfraHealth(env, dryRunHealthOptions(executor, options.health ?? {}));
  logServiceHealth(logger, 'infra health', health);

  if (!health.ok) {
    throw new CliError('Infrastructure services did not become healthy in time.');
  }
}
