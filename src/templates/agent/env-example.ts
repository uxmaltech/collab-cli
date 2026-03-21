import { PROVIDER_DEFAULTS } from '../../lib/providers';
import type { AgentBootstrapOptions } from '../../lib/agent-bootstrap/types';

export function agentEnvExampleTemplate(options: AgentBootstrapOptions): string {
  const providerDefaults = PROVIDER_DEFAULTS[options.provider];
  const runtimeAuthLine =
    options.providerAuthMethod === 'api-key' && providerDefaults.envVar
      ? `${providerDefaults.envVar}=`
      : `# ${providerDefaults.label} is configured for CLI authentication`;

  return [
    '# Collab agent bootstrap environment',
    `COLLAB_AGENT_PROVIDER=${options.provider}`,
    `COLLAB_AGENT_AUTH_METHOD=${options.providerAuthMethod}`,
    `COLLAB_AGENT_MODEL=${options.providerAuthMethod === 'api-key' ? (options.model ?? '') : ''}`,
    `COGNITIVE_MCP_URL=${options.cognitiveMcpUrl}`,
    'COGNITIVE_MCP_API_KEY=',
    `REDIS_URL=${options.redisUrl}`,
    'REDIS_PASSWORD=collab-dev-redis',
    'TELEGRAM_BOT_TOKEN=',
    '# Operational output goes to the originating operator by DM.',
    '# Set TELEGRAM_DEFAULT_CHAT_ID + TELEGRAM_THREAD_ID only when you also want a group summary thread.',
    'TELEGRAM_DEFAULT_CHAT_ID=',
    'TELEGRAM_THREAD_ID=',
    '',
    '# Runtime provider auth',
    runtimeAuthLine,
    '',
    '# Standard model taxonomy',
    'GEMINI_API_KEY=',
    'GEMINI_MODEL=gemini-2.5-pro',
    'OPENAI_API_KEY=',
    'OPENAI_MODEL=',
    'XAI_API_KEY=',
    'XAI_MODEL=',
    '# Claude models use Anthropic credentials',
    'ANTHROPIC_API_KEY=',
    'ANTHROPIC_MODEL=',
    '',
  ].join('\n');
}
