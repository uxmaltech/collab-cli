import path from 'node:path';

import type { CollabConfig } from '../../lib/config';
import type { Executor } from '../../lib/executor';
import { CliError } from '../../lib/errors';
import type { Logger } from '../../lib/logger';
import { ensureCommandAvailable, ensureFileExists } from '../../lib/preconditions';
import { getComposeFilePaths, selectMcpComposeFile } from '../../lib/compose-paths';
import { runDockerCompose } from '../../lib/docker-compose';
import {
  dryRunHealthOptions,
  loadRuntimeEnv,
  logServiceHealth,
  waitForMcpHealth,
  type ServiceHealthOptions,
} from '../../lib/service-health';

export interface McpSelection {
  filePath: string;
  source: 'consolidated' | 'split';
}

export interface McpRunOptions {
  health?: ServiceHealthOptions;
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

export async function runMcpCompose(
  logger: Logger,
  executor: Executor,
  config: CollabConfig,
  selection: McpSelection,
  action: 'up' | 'stop' | 'ps',
  options: McpRunOptions = {},
): Promise<void> {
  ensureCommandAvailable('docker', { dryRun: executor.dryRun });
  if (!executor.dryRun) {
    ensureFileExists(selection.filePath, 'Compose file');
  }

  const args = action === 'up' ? ['up', '-d'] : action === 'stop' ? ['stop'] : ['ps'];
  const serviceScope = selection.source === 'consolidated' ? ['mcp'] : [];

  runDockerCompose({
    executor,
    files: [selection.filePath],
    arguments: [...args, ...serviceScope],
    cwd: config.workspaceDir,
    projectName: config.compose.projectName,
  });

  if (action !== 'up') {
    return;
  }

  const env = loadRuntimeEnv(config);
  const health = await waitForMcpHealth(env, dryRunHealthOptions(executor, options.health ?? {}));
  logServiceHealth(logger, 'mcp health', health);

  if (!health.ok) {
    throw new CliError('MCP service did not become healthy in time.');
  }
}
