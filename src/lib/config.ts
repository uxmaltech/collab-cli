import fs from 'node:fs';
import path from 'node:path';

import { DEFAULT_MODE, type CollabMode, parseMode } from './mode';

export interface ComposePathConfig {
  consolidatedFile: string;
  infraFile: string;
  mcpFile: string;
}

export interface CollabConfig {
  workspaceDir: string;
  collabDir: string;
  configFile: string;
  stateFile: string;
  envFile: string;
  mode: CollabMode;
  compose: ComposePathConfig;
}

interface RawCollabConfig {
  compose?: Partial<ComposePathConfig>;
  envFile?: string;
  mode?: string;
}

const DEFAULT_COMPOSE_PATHS: ComposePathConfig = {
  consolidatedFile: 'docker-compose.yml',
  infraFile: 'docker-compose.infra.yml',
  mcpFile: 'docker-compose.mcp.yml',
};

export function defaultCollabConfig(cwd = process.cwd()): CollabConfig {
  const workspaceDir = path.resolve(cwd);
  const collabDir = path.join(workspaceDir, '.collab');

  return {
    workspaceDir,
    collabDir,
    configFile: path.join(collabDir, 'config.json'),
    stateFile: path.join(collabDir, 'state.json'),
    envFile: path.join(workspaceDir, '.env'),
    mode: DEFAULT_MODE,
    compose: { ...DEFAULT_COMPOSE_PATHS },
  };
}

function readRawConfig(configFile: string): RawCollabConfig {
  if (!fs.existsSync(configFile)) {
    return {};
  }

  const raw = fs.readFileSync(configFile, 'utf8');
  const parsed = JSON.parse(raw) as RawCollabConfig;
  return parsed;
}

export function loadCollabConfig(cwd = process.cwd()): CollabConfig {
  const defaults = defaultCollabConfig(cwd);
  const raw = readRawConfig(defaults.configFile);

  return {
    ...defaults,
    mode: parseMode(raw.mode, defaults.mode),
    envFile: raw.envFile ? path.resolve(defaults.workspaceDir, raw.envFile) : defaults.envFile,
    compose: {
      consolidatedFile: raw.compose?.consolidatedFile ?? defaults.compose.consolidatedFile,
      infraFile: raw.compose?.infraFile ?? defaults.compose.infraFile,
      mcpFile: raw.compose?.mcpFile ?? defaults.compose.mcpFile,
    },
  };
}

export function ensureCollabDirectory(config: CollabConfig): void {
  fs.mkdirSync(config.collabDir, { recursive: true });
}

export function serializeUserConfig(config: CollabConfig): string {
  return JSON.stringify(
    {
      mode: config.mode,
      compose: config.compose,
      envFile: path.relative(config.workspaceDir, config.envFile),
    },
    null,
    2,
  );
}
