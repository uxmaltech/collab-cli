import { readEnvFile, renderEnvFile } from '../../lib/env-file';
import type { AgentBootstrapOptions } from '../../lib/agent-bootstrap/types';

const ENV_KEY_ORDER = [
  'COLLAB_AGENT_PROVIDER',
  'COLLAB_AGENT_AUTH_METHOD',
  'COLLAB_AGENT_MODEL',
  'COGNITIVE_MCP_URL',
  'COGNITIVE_MCP_API_KEY',
  'REDIS_URL',
  'REDIS_PASSWORD',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_PUBLIC_BASE_URL',
  'TELEGRAM_WEBHOOK_SECRET',
  'TELEGRAM_WEBHOOK_BIND_HOST',
  'TELEGRAM_WEBHOOK_PORT',
  'TELEGRAM_DEFAULT_CHAT_ID',
  'TELEGRAM_THREAD_ID',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'XAI_API_KEY',
  'XAI_MODEL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
] as const;

function mergeManagedEnv(existing: Record<string, string>, defaults: Record<string, string>): Record<string, string> {
  const merged: Record<string, string> = { ...defaults };

  for (const [key, value] of Object.entries(existing)) {
    if (!(key in defaults)) {
      merged[key] = value;
      continue;
    }

    if (value.trim().length > 0) {
      merged[key] = value;
    }
  }

  return merged;
}

export function agentEnvTemplate(options: AgentBootstrapOptions): string {
  const existing = readEnvFile(options.outputDir + '/.env');
  const defaults = {
    COLLAB_AGENT_PROVIDER: options.provider,
    COLLAB_AGENT_AUTH_METHOD: options.providerAuthMethod,
    COLLAB_AGENT_MODEL: options.providerAuthMethod === 'api-key' ? (options.model ?? '') : '',
    COGNITIVE_MCP_URL: options.cognitiveMcpUrl,
    COGNITIVE_MCP_API_KEY: options.cognitiveMcpApiKey,
    REDIS_URL: options.redisUrl,
    REDIS_PASSWORD: options.redisPassword,
    TELEGRAM_BOT_TOKEN: options.telegramBotToken,
    TELEGRAM_WEBHOOK_PUBLIC_BASE_URL: options.telegramWebhookPublicBaseUrl,
    TELEGRAM_WEBHOOK_SECRET: options.telegramWebhookSecret,
    TELEGRAM_WEBHOOK_BIND_HOST: options.telegramWebhookBindHost,
    TELEGRAM_WEBHOOK_PORT: options.telegramWebhookPort,
    TELEGRAM_DEFAULT_CHAT_ID: options.telegramDefaultChatId,
    TELEGRAM_THREAD_ID: options.telegramThreadId,
    GEMINI_API_KEY: existing.GEMINI_API_KEY ?? '',
    GEMINI_MODEL: existing.GEMINI_MODEL ?? 'gemini-2.5-pro',
    OPENAI_API_KEY: existing.OPENAI_API_KEY ?? '',
    OPENAI_MODEL: existing.OPENAI_MODEL ?? '',
    XAI_API_KEY: existing.XAI_API_KEY ?? '',
    XAI_MODEL: existing.XAI_MODEL ?? '',
    ANTHROPIC_API_KEY: existing.ANTHROPIC_API_KEY ?? '',
    ANTHROPIC_MODEL: existing.ANTHROPIC_MODEL ?? '',
  };

  return renderEnvFile(mergeManagedEnv(existing, defaults), ENV_KEY_ORDER);
}
