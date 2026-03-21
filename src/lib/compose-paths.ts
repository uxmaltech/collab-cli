import fs from 'node:fs';
import path from 'node:path';

import type { CollabConfig } from './config';
import type { ServiceHealthOptions } from './service-health';

export type ComposeMode = 'consolidated' | 'split';

export interface ComposeFilePaths {
  consolidated: string;
  infra: string;
  mcp: string;
}

export interface ComposeSelection {
  file: string;
  source: ComposeMode;
}

/**
 * Shared selection shape used by infra and MCP compose commands.
 * Contains the resolved file path and topology source.
 */
export interface ComposeServiceSelection {
  filePath: string;
  source: ComposeMode;
}

/**
 * Shared run options for compose service commands (infra/MCP).
 */
export interface ComposeRunOptions {
  health?: ServiceHealthOptions;
  /** When true, passes `--no-deps` to `docker compose up` so dependency services are not started. */
  noDeps?: boolean;
}

export function getComposeFilePaths(config: CollabConfig, outputDirectory?: string): ComposeFilePaths {
  const targetDirectory = outputDirectory
    ? path.resolve(config.workspaceDir, outputDirectory)
    : config.workspaceDir;

  return {
    consolidated: path.resolve(targetDirectory, config.compose.consolidatedFile),
    infra: path.resolve(targetDirectory, config.compose.infraFile),
    mcp: path.resolve(targetDirectory, config.compose.mcpFile),
  };
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function selectInfraComposeFile(paths: ComposeFilePaths): ComposeSelection {
  if (fileExists(paths.infra)) {
    return { file: paths.infra, source: 'split' };
  }

  return { file: paths.consolidated, source: 'consolidated' };
}

export function selectMcpComposeFile(paths: ComposeFilePaths): ComposeSelection {
  if (fileExists(paths.mcp)) {
    return { file: paths.mcp, source: 'split' };
  }

  return { file: paths.consolidated, source: 'consolidated' };
}
