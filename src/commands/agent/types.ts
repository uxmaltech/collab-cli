import type { AgentBootstrapForceMode } from '../../lib/agent-bootstrap/types';

export interface AgentBootstrapCommandOptions {
  agentName?: string;
  agentSlug?: string;
  agentId?: string;
  scope?: string;
  provider?: string;
  model?: string;
  providerAuth?: 'api-key' | 'cli';
  operatorId?: string;
  githubAppId?: string;
  githubAppInstallationId?: string;
  githubAppOwner?: string;
  githubAppOwnerType?: 'auto' | 'org' | 'user';
  githubAppPrivateKeyPath?: string;
  telegramBotToken?: string;
  telegramDefaultChatId?: string;
  telegramThreadId?: string;
  telegramAllowTopicCommands?: boolean;
  telegramWebhookPublicBaseUrl?: string;
  telegramWebhookSecret?: string;
  telegramWebhookBindHost?: string;
  telegramWebhookPort?: string;
  cognitiveMcpUrl?: string;
  redisUrl?: string;
  approvedNamespaces?: string;
  egressUrl?: string[];
  selfRepository?: string;
  assignedRepositories?: string;
  output?: string;
  force?: AgentBootstrapForceMode;
  json?: boolean;
  interactive?: boolean;
  telemetry?: boolean;
  operatorProfile?: boolean;
}

export interface AgentStartCommandOptions {
  json?: boolean;
}
