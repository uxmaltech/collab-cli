import path from 'node:path';

import type { CollabConfig } from '../../lib/config';
import { runDockerCompose } from '../../lib/docker-compose';
import type { Logger } from '../../lib/logger';
import { ensureCommandAvailable, ensureFileExists } from '../../lib/preconditions';
import { getComposeFilePaths, selectInfraComposeFile } from '../../lib/compose-paths';

export const INFRA_SERVICES = ['qdrant', 'metad0', 'storaged0', 'graphd'] as const;

export interface InfraSelection {
  filePath: string;
  source: 'consolidated' | 'split';
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

export function runInfraCompose(
  logger: Logger,
  cwd: string,
  selection: InfraSelection,
  action: 'up' | 'stop' | 'ps',
): void {
  ensureCommandAvailable('docker');
  ensureFileExists(selection.filePath, 'Compose file');

  const args = action === 'up' ? ['up', '-d'] : action === 'stop' ? ['stop'] : ['ps'];
  const services = selection.source === 'consolidated' ? [...INFRA_SERVICES] : [];

  runDockerCompose({
    files: [selection.filePath],
    arguments: [...args, ...services],
    cwd,
    logger,
  });
}
