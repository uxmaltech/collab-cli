import { PROVIDER_DEFAULTS } from '../../lib/providers';
import type { AgentBootstrapOptions } from '../../lib/agent-bootstrap/types';

export function agentConfigTemplate(options: AgentBootstrapOptions): string {
  const telegramOperatorUserIds = options.operatorIds
    .map((operatorId) => /^operator\.telegram\.(\d+)$/.exec(operatorId)?.[1])
    .filter((userId): userId is string => Boolean(userId));
  const operationalOutputMode =
    options.telegramEnabled && telegramOperatorUserIds.length > 0
      ? 'originating-operator'
      : 'disabled';
  const teamSummaryMode =
    options.telegramThreadId.trim().length > 0
      ? 'thread'
      : 'disabled';
  const providerDefaults = PROVIDER_DEFAULTS[options.provider];
  const providerConfig: Record<string, unknown> = {
    enabled: true,
    auth: {
      method: options.providerAuthMethod,
      ...(options.providerAuthMethod === 'api-key' && providerDefaults.envVar
        ? { envVar: providerDefaults.envVar }
        : {}),
    },
    ...(options.providerAuthMethod === 'api-key' && options.model ? { model: options.model } : {}),
    ...(options.providerAuthMethod === 'cli'
      ? {
          cli: {
            command: options.providerCli.command,
            available: options.providerCli.available,
            ...(options.providerCli.version ? { version: options.providerCli.version } : {}),
            ...(options.providerCli.configuredModel
              ? { configuredModel: options.providerCli.configuredModel }
              : {}),
          },
        }
      : {}),
  };

  const payload = {
    mode: 'indexed',
    envFile: '.env',
    compose: {
      consolidatedFile: 'infra/docker-compose.yml',
      infraFile: 'infra/docker-compose.infra.yml',
      mcpFile: 'infra/docker-compose.mcp.yml',
    },
    infraType: 'local',
    agent: {
      id: options.agentId,
      name: options.agentName,
      slug: options.agentSlug,
      scope: options.scope,
      runtimeSource: options.runtimeSource,
      defaultProvider: options.provider,
      defaultProviderAuthMethod: options.providerAuthMethod,
      ...(options.providerAuthMethod === 'api-key' && options.model
        ? { defaultModel: options.model }
        : {}),
      redisUrl: options.redisUrl,
      mcp: {
        cognitive: {
          serverUrl: options.cognitiveMcpUrl,
          apiKeyEnvVar: 'COGNITIVE_MCP_API_KEY',
        },
      },
      notifications: {
        telegram: {
          enabled: options.telegramEnabled,
          botTokenEnvVar: 'TELEGRAM_BOT_TOKEN',
          transport: {
            mode: 'webhook',
            publicBaseUrlEnvVar: 'TELEGRAM_WEBHOOK_PUBLIC_BASE_URL',
            secretEnvVar: 'TELEGRAM_WEBHOOK_SECRET',
            bindHostEnvVar: 'TELEGRAM_WEBHOOK_BIND_HOST',
            portEnvVar: 'TELEGRAM_WEBHOOK_PORT',
          },
          defaultChatIdEnvVar: 'TELEGRAM_DEFAULT_CHAT_ID',
          threadIdEnvVar: 'TELEGRAM_THREAD_ID',
          operationalOutput: {
            mode: operationalOutputMode,
            primaryOperatorProfileId: options.operatorId,
            operatorProfileIds: options.operatorIds,
            ...(telegramOperatorUserIds.length > 0
              ? { operatorTelegramUserIds: telegramOperatorUserIds }
              : {}),
          },
          teamSummary: {
            mode: teamSummaryMode,
          },
          commandIngress: {
            allowTopicCommands: options.telegramAllowTopicCommands,
            allowDirectMessagesFromOperator: telegramOperatorUserIds.length > 0,
          },
        },
      },
      infrastructure: {
        compose: {
          file: 'infra/docker-compose.yml',
          infraFile: 'infra/docker-compose.infra.yml',
          mcpFile: 'infra/docker-compose.mcp.yml',
        },
        services: {
          redis: {
            urlEnvVar: 'REDIS_URL',
            passwordEnvVar: 'REDIS_PASSWORD',
          },
          cognitiveMcp: {
            urlEnvVar: 'COGNITIVE_MCP_URL',
            apiKeyEnvVar: 'COGNITIVE_MCP_API_KEY',
          },
        },
      },
      persistence: {
        durableStateBackend: 'cognitive-mcp',
        durableNamespaces: [
          'agent.identity.*',
          'agent.project.*',
          'agent.task.*',
          'agent.session.*',
          'agent.memory.*',
        ],
        policy:
          'Persist agent identity, project, task, session, and memory state in the cognitive infrastructure through Collab contracts.',
      },
      selfRepository: options.selfRepository,
      assignedRepositories: options.assignedRepositories,
      telemetry: {
        enabled: options.telemetryEnabled,
      },
      egress: {
        allow: options.egressUrls,
      },
      profiles: {
        worker: {
          enabled: true,
          approvedNamespaces: options.approvedNamespaces,
        },
        operator: {
          enabled: options.operatorProfileEnabled,
          id: options.operatorId,
          ids: options.operatorIds,
          approvedNamespaces: options.operatorNamespaces,
        },
      },
      skills: {
        rootDir: 'skills',
        local: [`${options.agentSlug}-bootstrap`],
      },
      entrypoint: {
        file: 'index.js',
        defaultArgs: ['development'],
      },
      birth: {
        birthFile: `fixtures/${options.agentSlug}/agent-birth.json`,
        visiblePromptsFile: `fixtures/${options.agentSlug}/visible-prompts.json`,
        guideFile: `docs/${options.agentSlug}-birth.md`,
        envExampleFile: '.env.example',
      },
    },
    assistants: {
      providers: {
        [options.provider]: providerConfig,
      },
    },
  };

  return JSON.stringify(payload, null, 2) + '\n';
}
