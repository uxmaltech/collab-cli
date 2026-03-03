import fs from 'node:fs';
import path from 'node:path';

import { DEFAULT_MODE, type CollabMode, parseMode } from './mode';
import type { AssistantsConfig } from './providers';

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
  architectureDir: string;
  uxmaltechDir: string;
  repoDir: string;
  aiDir: string;
  assistants?: AssistantsConfig;
}

interface RawCollabConfig {
  compose?: Partial<ComposePathConfig>;
  envFile?: string;
  mode?: string;
  architectureDir?: string;
  assistants?: AssistantsConfig;
}

const DEFAULT_COMPOSE_PATHS: ComposePathConfig = {
  consolidatedFile: 'docker-compose.yml',
  infraFile: 'docker-compose.infra.yml',
  mcpFile: 'docker-compose.mcp.yml',
};

export function defaultCollabConfig(cwd = process.cwd()): CollabConfig {
  const workspaceDir = path.resolve(cwd);
  const collabDir = path.join(workspaceDir, '.collab');
  const architectureDir = path.join(workspaceDir, 'docs', 'architecture');

  return {
    workspaceDir,
    collabDir,
    configFile: path.join(collabDir, 'config.json'),
    stateFile: path.join(collabDir, 'state.json'),
    envFile: path.join(workspaceDir, '.env'),
    mode: DEFAULT_MODE,
    compose: { ...DEFAULT_COMPOSE_PATHS },
    architectureDir,
    uxmaltechDir: path.join(architectureDir, 'uxmaltech'),
    repoDir: path.join(architectureDir, 'repo'),
    aiDir: path.join(workspaceDir, 'docs', 'ai'),
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

  const architectureDir = raw.architectureDir
    ? path.resolve(defaults.workspaceDir, raw.architectureDir)
    : defaults.architectureDir;

  return {
    ...defaults,
    mode: parseMode(raw.mode, defaults.mode),
    envFile: raw.envFile ? path.resolve(defaults.workspaceDir, raw.envFile) : defaults.envFile,
    compose: {
      consolidatedFile: raw.compose?.consolidatedFile ?? defaults.compose.consolidatedFile,
      infraFile: raw.compose?.infraFile ?? defaults.compose.infraFile,
      mcpFile: raw.compose?.mcpFile ?? defaults.compose.mcpFile,
    },
    architectureDir,
    uxmaltechDir: path.join(architectureDir, 'uxmaltech'),
    repoDir: path.join(architectureDir, 'repo'),
    aiDir: path.join(defaults.workspaceDir, 'docs', 'ai'),
    assistants: raw.assistants,
  };
}

export function ensureCollabDirectory(config: CollabConfig): void {
  fs.mkdirSync(config.collabDir, { recursive: true });
}

export function serializeUserConfig(config: CollabConfig): string {
  const data: Record<string, unknown> = {
    mode: config.mode,
    compose: config.compose,
    envFile: path.relative(config.workspaceDir, config.envFile),
  };

  if (config.assistants) {
    data.assistants = config.assistants;
  }

  return JSON.stringify(data, null, 2);
}
