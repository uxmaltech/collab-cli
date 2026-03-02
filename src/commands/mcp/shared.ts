import path from 'node:path';

import type { CollabConfig } from '../../lib/config';
import { runDockerCompose } from '../../lib/docker-compose';
import type { Logger } from '../../lib/logger';
import { ensureCommandAvailable, ensureFileExists } from '../../lib/preconditions';
import { getComposeFilePaths, selectMcpComposeFile } from '../../lib/compose-paths';

export interface McpSelection {
  filePath: string;
  source: 'consolidated' | 'split';
}

export function resolveMcpComposeFile(
  config: CollabConfig,
  outputDirectory: string | undefined,
  explicitFile: string | undefined,
): McpSelection {
  if (explicitFile) {
    const filePath = path.resolve(config.workspaceDir, explicitFile);
    return { filePath, source: 'split' };
  }

  const paths = getComposeFilePaths(config, outputDirectory);
  const selected = selectMcpComposeFile(paths);

  return {
    filePath: selected.file,
    source: selected.source,
  };
}

export function runMcpCompose(
  logger: Logger,
  cwd: string,
  selection: McpSelection,
  action: 'up' | 'stop' | 'ps',
): void {
  ensureCommandAvailable('docker');
  ensureFileExists(selection.filePath, 'Compose file');

  const args = action === 'up' ? ['up', '-d'] : action === 'stop' ? ['stop'] : ['ps'];
  const serviceScope = selection.source === 'consolidated' ? ['mcp'] : [];

  runDockerCompose({
    files: [selection.filePath],
    arguments: [...args, ...serviceScope],
    cwd,
    logger,
  });
}
