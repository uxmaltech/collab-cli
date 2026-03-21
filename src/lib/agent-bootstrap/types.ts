import type { CliInfo } from '../cli-detection';
import type { AuthMethod, ProviderKey } from '../providers';

export const AGENT_BOOTSTRAP_FORCE_MODES = ['overwrite', 'rebirth'] as const;
export type AgentBootstrapForceMode = (typeof AGENT_BOOTSTRAP_FORCE_MODES)[number];

export interface AgentBirthProfile {
  purpose: string;
  personaRole: string;
  personaTone: string;
  personaSummary: string;
  soulMission: string;
  soulEthos: string;
  soulGuardrails: string[];
  systemPrompt: string;
  styleRules: string[];
  workStylePlanningMode: string;
  workStyleApprovalPosture: string;
  workStyleCollaborationStyle: string;
}

export interface AgentBootstrapInput {
  cwd: string;
  agentName?: string;
  agentSlug?: string;
  agentId?: string;
  scope?: string;
  runtimeSource?: string;
  provider?: string;
  model?: string;
  providerAuthMethod?: AuthMethod;
  operatorId?: string;
  cognitiveMcpUrl?: string;
  cognitiveMcpApiKey?: string;
  redisUrl?: string;
  redisPassword?: string;
  approvedNamespaces?: string;
  egressUrl?: string[];
  telegramEnabled?: boolean;
  telegramBotToken?: string;
  telegramDefaultChatId?: string;
  telegramThreadId?: string;
  telegramAllowTopicCommands?: boolean;
  selfRepository?: string;
  assignedRepositories?: string;
  birthProfile?: Partial<AgentBirthProfile>;
  output?: string;
  forceMode?: AgentBootstrapForceMode;
  json?: boolean;
  interactive?: boolean;
  telemetryEnabled?: boolean;
  operatorProfileEnabled?: boolean;
}

export interface AgentBootstrapOptions {
  cwd: string;
  outputDir: string;
  agentName: string;
  agentSlug: string;
  agentId: string;
  scope: string;
  runtimeSource: string;
  provider: ProviderKey;
  providerAuthMethod: AuthMethod;
  providerCli: CliInfo;
  model?: string;
  operatorId: string;
  operatorIds: string[];
  cognitiveMcpUrl: string;
  cognitiveMcpApiKey: string;
  redisUrl: string;
  redisPassword: string;
  approvedNamespaces: string[];
  operatorNamespaces: string[];
  egressUrls: string[];
  telegramEnabled: boolean;
  telegramBotToken: string;
  telegramDefaultChatId: string;
  telegramThreadId: string;
  telegramAllowTopicCommands: boolean;
  selfRepository: string;
  assignedRepositories: string[];
  birthProfile: AgentBirthProfile;
  forceMode?: AgentBootstrapForceMode;
  overwriteExistingManagedFiles: boolean;
  restartWizardFromScratch: boolean;
  json: boolean;
  telemetryEnabled: boolean;
  operatorProfileEnabled: boolean;
}

export interface AgentBootstrapPaths {
  configFile: string;
  envExampleFile: string;
  envFile: string;
  gitignoreFile: string;
  packageJsonFile: string;
  dockerfile: string;
  entrypointFile: string;
  birthFile: string;
  visiblePromptsFile: string;
  birthDocFile: string;
  skillFile: string;
  composeFile: string;
  infraComposeFile: string;
  mcpComposeFile: string;
}

export interface GeneratedFile {
  absolutePath: string;
  relativePath: string;
  content: string;
  description: string;
}

export interface AgentBootstrapResult {
  options: AgentBootstrapOptions;
  files: GeneratedFile[];
}

export interface AgentBootstrapSummary {
  agent: {
    name: string;
    slug: string;
    id: string;
    scope: string;
    provider: ProviderKey;
    providerAuthMethod: AuthMethod;
    model?: string;
    outputDir: string;
    cognitiveMcpUrl: string;
    selfRepository: string;
    assignedRepositories: string[];
  };
  files: Array<{ path: string }>;
}
