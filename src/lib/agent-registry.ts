import fs from 'node:fs';
import path from 'node:path';

import type { AuthMethod, ProviderKey } from './providers';
import type { AgentBootstrapOptions } from './agent-bootstrap/types';

export interface BornAgentRecord {
  id: string;
  name: string;
  slug: string;
  scope: string;
  rootDir: string;
  entryFile: string;
  defaultArgs: string[];
  configFile: string;
  birthFile: string;
  selfRepository: string;
  assignedRepositories: string[];
  provider: ProviderKey;
  providerAuthMethod: AuthMethod;
  model?: string;
}

interface BornAgentsRegistryFile {
  version: 1;
  agents: BornAgentRecord[];
}

interface ActiveAgentFile {
  version: 1;
  activeAgentId: string;
  startedAt: string;
  agent: BornAgentRecord;
}

interface ExistingAgentConfig {
  agent?: {
    id?: string;
    name?: string;
    slug?: string;
    scope?: string;
    defaultProvider?: string;
    defaultProviderAuthMethod?: string;
    defaultModel?: string;
    selfRepository?: string;
    assignedRepositories?: string[];
    entrypoint?: {
      file?: string;
      defaultArgs?: string[];
    };
    birth?: {
      birthFile?: string;
    };
  };
}

const BORN_AGENTS_REGISTRY_FILE = path.join('.collab', 'agents.json');
const ACTIVE_AGENT_FILE = path.join('.collab', 'active-agent.json');

function readJsonIfExists<T>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function normalizeBornAgentRecord(agent: BornAgentRecord): BornAgentRecord {
  return {
    ...agent,
    entryFile: typeof agent.entryFile === 'string' && agent.entryFile.trim().length > 0
      ? agent.entryFile
      : 'index.js',
    defaultArgs: Array.isArray(agent.defaultArgs) && agent.defaultArgs.length > 0
      ? agent.defaultArgs
      : ['development'],
  };
}

function normalizeAuthMethod(value: string | undefined): AuthMethod {
  return value === 'cli' ? 'cli' : 'api-key';
}

function normalizeProvider(value: string | undefined): ProviderKey {
  switch ((value ?? '').trim().toLowerCase()) {
    case 'claude':
      return 'claude';
    case 'gemini':
      return 'gemini';
    case 'copilot':
      return 'copilot';
    case 'codex':
    default:
      return 'codex';
  }
}

function resolveRegistryRootDir(
  controlWorkspaceDir: string,
  agentRootDir: string,
): string {
  const relativeRoot = path.relative(controlWorkspaceDir, agentRootDir);
  if (!relativeRoot || relativeRoot === '') {
    return '.';
  }

  if (!relativeRoot.startsWith('..') && !path.isAbsolute(relativeRoot)) {
    return relativeRoot;
  }

  return agentRootDir;
}

function readBornAgentRecordFromAgentRoot(
  agentRootDir: string,
  controlWorkspaceDir: string,
): BornAgentRecord | undefined {
  const configPath = path.join(agentRootDir, '.collab', 'config.json');
  const config = readJsonIfExists<ExistingAgentConfig>(configPath);
  const agent = config?.agent;

  if (!agent?.id || !agent?.name || !agent?.slug || !agent?.scope || !agent?.selfRepository) {
    return undefined;
  }

  return {
    id: agent.id,
    name: agent.name,
    slug: agent.slug,
    scope: agent.scope,
    rootDir: resolveRegistryRootDir(controlWorkspaceDir, agentRootDir),
    entryFile: agent.entrypoint?.file?.trim() || 'index.js',
    defaultArgs:
      Array.isArray(agent.entrypoint?.defaultArgs) && agent.entrypoint.defaultArgs.length > 0
        ? agent.entrypoint.defaultArgs
        : ['development'],
    configFile: path.join('.collab', 'config.json'),
    birthFile: agent.birth?.birthFile?.trim() || path.join('fixtures', agent.slug, 'agent-birth.json'),
    selfRepository: agent.selfRepository,
    assignedRepositories: Array.isArray(agent.assignedRepositories) ? agent.assignedRepositories : [],
    provider: normalizeProvider(agent.defaultProvider),
    providerAuthMethod: normalizeAuthMethod(agent.defaultProviderAuthMethod),
    model: agent.defaultModel?.trim() || undefined,
  };
}

function discoverBornAgentsInChildren(workspaceDir: string): BornAgentRecord[] {
  if (!fs.existsSync(workspaceDir)) {
    return [];
  }

  const entries = fs.readdirSync(workspaceDir, { withFileTypes: true });
  const agents: BornAgentRecord[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) {
      continue;
    }

    const agentRootDir = path.join(workspaceDir, entry.name);
    const record = readBornAgentRecordFromAgentRoot(agentRootDir, workspaceDir);
    if (record) {
      agents.push(record);
    }
  }

  return agents;
}

export function buildBornAgentsRegistryPath(workspaceDir: string): string {
  return path.join(workspaceDir, BORN_AGENTS_REGISTRY_FILE);
}

export function buildActiveAgentPath(workspaceDir: string): string {
  return path.join(workspaceDir, ACTIVE_AGENT_FILE);
}

export function resolveBornAgentRootDir(
  controlWorkspaceDir: string,
  agent: Pick<BornAgentRecord, 'rootDir'>,
): string {
  return path.resolve(controlWorkspaceDir, agent.rootDir);
}

export function createBornAgentRecord(
  options: AgentBootstrapOptions,
  controlWorkspaceDir: string,
): BornAgentRecord {
  return {
    id: options.agentId,
    name: options.agentName,
    slug: options.agentSlug,
    scope: options.scope,
    rootDir: resolveRegistryRootDir(controlWorkspaceDir, options.outputDir),
    entryFile: 'index.js',
    defaultArgs: ['development'],
    configFile: path.join('.collab', 'config.json'),
    birthFile: path.join('fixtures', options.agentSlug, 'agent-birth.json'),
    selfRepository: options.selfRepository,
    assignedRepositories: options.assignedRepositories,
    provider: options.provider,
    providerAuthMethod: options.providerAuthMethod,
    model: options.model,
  };
}

export function loadBornAgents(workspaceDir: string): BornAgentRecord[] {
  const registryPath = buildBornAgentsRegistryPath(workspaceDir);
  const registry = readJsonIfExists<BornAgentsRegistryFile>(registryPath);
  const registryAgents = registry?.version === 1 && Array.isArray(registry.agents)
    ? registry.agents.map((agent) => normalizeBornAgentRecord(agent))
    : [];
  const discoveredAgents = [
    readBornAgentRecordFromAgentRoot(workspaceDir, workspaceDir),
    ...discoverBornAgentsInChildren(workspaceDir),
  ].filter((agent): agent is BornAgentRecord => Boolean(agent));

  const merged = [...registryAgents];
  for (const discovered of discoveredAgents) {
    if (!merged.some((agent) => agent.id === discovered.id)) {
      merged.push(discovered);
    }
  }

  return merged;
}

export function saveBornAgent(
  workspaceDir: string,
  agent: BornAgentRecord,
): string {
  const registryPath = buildBornAgentsRegistryPath(workspaceDir);
  const existing = loadBornAgents(workspaceDir).filter((entry) => entry.id !== agent.id);
  const payload: BornAgentsRegistryFile = {
    version: 1,
    agents: [...existing, agent].sort((left, right) => left.id.localeCompare(right.id)),
  };

  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  return registryPath;
}

export function saveActiveAgent(
  workspaceDir: string,
  agent: BornAgentRecord,
): string {
  const activePath = buildActiveAgentPath(workspaceDir);
  const payload: ActiveAgentFile = {
    version: 1,
    activeAgentId: agent.id,
    startedAt: new Date().toISOString(),
    agent,
  };

  fs.mkdirSync(path.dirname(activePath), { recursive: true });
  fs.writeFileSync(activePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  return activePath;
}

export function findBornAgent(
  agents: readonly BornAgentRecord[],
  selector: string,
): BornAgentRecord | undefined {
  const normalizedSelector = selector.trim();
  return agents.find((agent) => agent.id === normalizedSelector)
    ?? agents.find((agent) => agent.slug === normalizedSelector)
    ?? agents.find((agent) => agent.name === normalizedSelector);
}
