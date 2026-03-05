import path from 'node:path';

import type { CollabConfig } from '../../lib/config';
import type { ComposeRunOptions, ComposeServiceSelection } from '../../lib/compose-paths';
import { getComposeFilePaths, selectMcpComposeFile } from '../../lib/compose-paths';
import { runDockerCompose } from '../../lib/docker-compose';
import { CliError } from '../../lib/errors';
import type { Executor } from '../../lib/executor';
import type { Logger } from '../../lib/logger';
import { ensureCommandAvailable, ensureFileExists } from '../../lib/preconditions';
import {
  dryRunHealthOptions,
  loadRuntimeEnv,
  logServiceHealth,
  waitForMcpHealth,
} from '../../lib/service-health';

/** @deprecated Use {@link ComposeServiceSelection} directly. */
export type McpSelection = ComposeServiceSelection;

/** @deprecated Use {@link ComposeRunOptions} directly. */
export type McpRunOptions = ComposeRunOptions;

/**
 * Resolves the compose file to use for the MCP service.
 * Prefers an explicit `--file` flag, then falls back to compose-paths resolution.
 */
export function resolveMcpComposeFile(
  config: CollabConfig,
  outputDirectory: string | undefined,
  explicitFile: string | undefined,
): ComposeServiceSelection {
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

/**
 * Runs a docker compose action for the MCP service.
 * When the action is `'up'`, waits for health checks to pass.
 */
export async function runMcpCompose(
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
