import fs from 'node:fs';
import path from 'node:path';

import { DEFAULT_MODE, type CollabMode, parseMode } from './mode';
import type { AssistantsConfig } from './providers';

export interface ComposePathConfig {
  consolidatedFile: string;
  infraFile: string;
  mcpFile: string;
}

export interface WorkspaceConfig {
  repos: string[];
}

export interface CanonConfig {
  /** GitHub repo slug: "owner/repo" */
  repo: string;
  /** Branch to track */
  branch: string;
  /** Local copy directory name under docs/architecture/ */
  localDir: string;
}

export interface CanonsConfig {
  business?: CanonConfig;
}

export interface RepoConfig {
  name: string;
  repoDir: string;
  architectureRepoDir: string;
  aiDir: string;
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
  workspace?: WorkspaceConfig;
  canons?: CanonsConfig;
}

interface RawCollabConfig {
  compose?: Partial<ComposePathConfig>;
  envFile?: string;
  mode?: string;
  architectureDir?: string;
  assistants?: AssistantsConfig;
  workspace?: WorkspaceConfig;
  canons?: CanonsConfig;
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
    workspace: raw.workspace,
    canons: raw.canons,
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

  if (config.workspace) {
    data.workspace = config.workspace;
  }

  if (config.canons) {
    data.canons = config.canons;
  }

  return JSON.stringify(data, null, 2);
}

// ────────────────────────────────────────────────────────────────
// Workspace helpers
// ────────────────────────────────────────────────────────────────

export function isWorkspaceMode(config: CollabConfig): boolean {
  return config.workspace !== undefined && config.workspace.repos.length > 0;
}

export function resolveRepoConfigs(config: CollabConfig): RepoConfig[] {
  if (!config.workspace) {
    return [];
  }

  return config.workspace.repos.map((repoName) => {
    const repoDir = path.join(config.workspaceDir, repoName);
    return {
      name: repoName,
      repoDir,
      architectureRepoDir: path.join(repoDir, 'docs', 'architecture', 'repo'),
      aiDir: path.join(repoDir, 'docs', 'ai'),
    };
  });
}

/**
 * Detects subdirectories of `workspaceDir` that contain a `.git` directory.
 * Returns sorted directory names (not full paths).
 */
export function discoverRepos(workspaceDir: string): string[] {
  const entries = fs.readdirSync(workspaceDir, { withFileTypes: true });
  const repos: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;

    const gitDir = path.join(workspaceDir, entry.name, '.git');
    if (fs.existsSync(gitDir)) {
      repos.push(entry.name);
    }
  }

  return repos.sort();
}

/**
 * Returns true when the directory looks like a workspace root:
 * no `.git/` of its own and at least two child git repos.
 */
export function isWorkspaceRoot(dir: string): boolean {
  const hasOwnGit = fs.existsSync(path.join(dir, '.git'));
  if (hasOwnGit) return false;

  return discoverRepos(dir).length >= 2;
}
