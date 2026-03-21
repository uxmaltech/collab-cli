import fs from 'node:fs';
import path from 'node:path';

import { readEnvFile } from '../env-file';
import type { AgentBootstrapInput, AgentBirthProfile } from './types';

interface ExistingAgentConfig {
  envFile?: string;
  agent?: {
    id?: string;
    name?: string;
    slug?: string;
    scope?: string;
    defaultProvider?: string;
    defaultProviderAuthMethod?: string;
    defaultModel?: string;
    redisUrl?: string;
    mcp?: {
      cognitive?: {
        serverUrl?: string;
        apiKeyEnvVar?: string;
      };
    };
    notifications?: {
      telegram?: {
        enabled?: boolean;
        botTokenEnvVar?: string;
        defaultChatIdEnvVar?: string;
        threadIdEnvVar?: string;
        commandIngress?: {
          allowTopicCommands?: boolean;
        };
      };
    };
    selfRepository?: string;
    assignedRepositories?: string[];
    telemetry?: {
      enabled?: boolean;
    };
    egress?: {
      allow?: string[];
    };
    profiles?: {
      worker?: {
        approvedNamespaces?: string[];
      };
      operator?: {
        enabled?: boolean;
        id?: string;
        ids?: string[];
      };
    };
    birth?: {
      birthFile?: string;
    };
  };
}

interface ExistingBirthFile {
  purpose?: string;
  persona?: {
    role?: string;
    tone?: string;
    summary?: string;
  };
  soul?: {
    mission?: string;
    ethos?: string;
    guardrails?: string[];
  };
  prompt_profile?: {
    system_prompt?: string;
    style_rules?: string[];
  };
  work_style?: {
    planning_mode?: string;
    approval_posture?: string;
    collaboration_style?: string;
  };
}

function readJsonIfExists<T>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function resolveBirthFilePath(outputDir: string, config: ExistingAgentConfig): string | undefined {
  const relativeBirthFile = config.agent?.birth?.birthFile;
  if (typeof relativeBirthFile === 'string' && relativeBirthFile.trim().length > 0) {
    return path.resolve(outputDir, relativeBirthFile);
  }

  const slug = config.agent?.slug?.trim();
  if (!slug) {
    return undefined;
  }

  return path.join(outputDir, 'fixtures', slug, 'agent-birth.json');
}

function mapExistingBirthProfile(payload: ExistingBirthFile | undefined): Partial<AgentBirthProfile> | undefined {
  if (!payload) {
    return undefined;
  }

  return {
    purpose: payload.purpose,
    personaRole: payload.persona?.role,
    personaTone: payload.persona?.tone,
    personaSummary: payload.persona?.summary,
    soulMission: payload.soul?.mission,
    soulEthos: payload.soul?.ethos,
    soulGuardrails: payload.soul?.guardrails,
    systemPrompt: payload.prompt_profile?.system_prompt,
    styleRules: payload.prompt_profile?.style_rules,
    workStylePlanningMode: payload.work_style?.planning_mode,
    workStyleApprovalPosture: payload.work_style?.approval_posture,
    workStyleCollaborationStyle: payload.work_style?.collaboration_style,
  };
}

export function loadExistingAgentBootstrapInput(outputDir: string): Partial<AgentBootstrapInput> {
  const configPath = path.join(outputDir, '.collab', 'config.json');
  const config = readJsonIfExists<ExistingAgentConfig>(configPath);

  if (!config?.agent) {
    return {};
  }

  const birthFilePath = resolveBirthFilePath(outputDir, config);
  const birthProfile = mapExistingBirthProfile(
    birthFilePath ? readJsonIfExists<ExistingBirthFile>(birthFilePath) : undefined,
  );
  const envFile = config.envFile
    ? path.resolve(outputDir, config.envFile)
    : path.join(outputDir, '.env');
  const env = readEnvFile(envFile);
  const telegramBotToken =
    config.agent.notifications?.telegram?.botTokenEnvVar
      ? env[config.agent.notifications.telegram.botTokenEnvVar]
      : undefined;
  const telegramDefaultChatId =
    config.agent.notifications?.telegram?.defaultChatIdEnvVar
      ? env[config.agent.notifications.telegram.defaultChatIdEnvVar]
      : undefined;
  const telegramThreadId =
    config.agent.notifications?.telegram?.threadIdEnvVar
      ? env[config.agent.notifications.telegram.threadIdEnvVar]
      : undefined;
  const telegramWebhookPublicBaseUrl = env.TELEGRAM_WEBHOOK_PUBLIC_BASE_URL;
  const telegramWebhookSecret = env.TELEGRAM_WEBHOOK_SECRET;
  const telegramWebhookBindHost = env.TELEGRAM_WEBHOOK_BIND_HOST;
  const telegramWebhookPort = env.TELEGRAM_WEBHOOK_PORT;
  return {
    output: outputDir,
    agentName: config.agent.name,
    agentSlug: config.agent.slug,
    agentId: config.agent.id,
    scope: config.agent.scope,
    provider: config.agent.defaultProvider,
    providerAuthMethod:
      config.agent.defaultProviderAuthMethod === 'cli' || config.agent.defaultProviderAuthMethod === 'api-key'
        ? config.agent.defaultProviderAuthMethod
        : undefined,
    model: config.agent.defaultModel,
    operatorId:
      config.agent.profiles?.operator?.ids?.join(',')
      || config.agent.profiles?.operator?.id,
    cognitiveMcpUrl: config.agent.mcp?.cognitive?.serverUrl,
    cognitiveMcpApiKey:
      config.agent.mcp?.cognitive?.apiKeyEnvVar
        ? env[config.agent.mcp.cognitive.apiKeyEnvVar]
        : undefined,
    redisUrl: config.agent.redisUrl,
    redisPassword: env.REDIS_PASSWORD,
    approvedNamespaces: config.agent.profiles?.worker?.approvedNamespaces?.join(','),
    egressUrl: config.agent.egress?.allow,
    telegramEnabled: config.agent.notifications?.telegram?.enabled,
    telegramBotToken,
    telegramDefaultChatId,
    telegramThreadId,
    telegramAllowTopicCommands: config.agent.notifications?.telegram?.commandIngress?.allowTopicCommands,
    telegramWebhookPublicBaseUrl,
    telegramWebhookSecret,
    telegramWebhookBindHost,
    telegramWebhookPort,
    selfRepository: config.agent.selfRepository,
    assignedRepositories: config.agent.assignedRepositories?.join(','),
    telemetryEnabled: config.agent.telemetry?.enabled,
    operatorProfileEnabled: config.agent.profiles?.operator?.enabled,
    birthProfile,
  };
}

export function hydrateAgentBootstrapEnv(outputDir: string): void {
  const configPath = path.join(outputDir, '.collab', 'config.json');
  const config = readJsonIfExists<ExistingAgentConfig>(configPath);
  const envFile = config?.envFile
    ? path.resolve(outputDir, config.envFile)
    : path.join(outputDir, '.env');
  const env = readEnvFile(envFile);

  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined && value.trim().length > 0) {
      process.env[key] = value;
    }
  }
}
