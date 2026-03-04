import type { CollabConfig } from './config';
import type { CliInfo } from './cli-detection';

export const PROVIDER_KEYS = ['codex', 'claude', 'gemini', 'copilot'] as const;

export type ProviderKey = (typeof PROVIDER_KEYS)[number];

export type AuthMethod = 'api-key' | 'cli';

export interface ProviderAuthConfig {
  method: AuthMethod;
  envVar?: string;
}

export interface ProviderConfig {
  enabled: boolean;
  auth: ProviderAuthConfig;
  model?: string;
  cli?: CliInfo;
}

export interface AssistantsConfig {
  providers: Partial<Record<ProviderKey, ProviderConfig>>;
}

export interface ProviderDefaults {
  label: string;
  description: string;
  envVar: string;
  models: string[];
}

export const PROVIDER_DEFAULTS: Record<ProviderKey, ProviderDefaults> = {
  codex: {
    label: 'Codex (OpenAI)',
    description: 'OpenAI models via codex CLI or API key',
    envVar: 'OPENAI_API_KEY',
    models: ['o3-pro', 'gpt-4.1', 'o4-mini'],
  },
  claude: {
    label: 'Claude (Anthropic)',
    description: 'Anthropic models via claude CLI or API key',
    envVar: 'ANTHROPIC_API_KEY',
    models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-35-20241022'],
  },
  gemini: {
    label: 'Gemini (Google)',
    description: 'Google AI models via gemini CLI or API key',
    envVar: 'GOOGLE_AI_API_KEY',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
  },
  copilot: {
    label: 'Copilot (GitHub)',
    description: 'GitHub Copilot via gh CLI — uses issues assigned to @copilot',
    envVar: '',
    models: [],
  },
};

const PROVIDER_SET = new Set<string>(PROVIDER_KEYS);

export function isProviderKey(value: string): value is ProviderKey {
  return PROVIDER_SET.has(value);
}

export function parseProviderList(value: string): ProviderKey[] {
  const keys = value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);

  const result: ProviderKey[] = [];

  for (const key of keys) {
    if (!isProviderKey(key)) {
      throw new Error(`Invalid provider '${key}'. Valid providers: ${PROVIDER_KEYS.join(', ')}`);
    }

    if (!result.includes(key)) {
      result.push(key);
    }
  }

  return result;
}

export function getEnabledProviders(config: CollabConfig): ProviderKey[] {
  const assistants = config.assistants;
  if (!assistants?.providers) {
    return [];
  }

  return PROVIDER_KEYS.filter((key) => assistants.providers[key]?.enabled === true);
}

/**
 * Auto-detects providers from environment variables and installed CLIs.
 * A provider is detected if its env var is set OR its CLI is on PATH.
 */
export function autoDetectProviders(): ProviderKey[] {
  // Lazy import to avoid circular dependency at module level
  const { detectProviderCli } = require('./cli-detection') as typeof import('./cli-detection');

  const detected: ProviderKey[] = [];

  for (const key of PROVIDER_KEYS) {
    const defaults = PROVIDER_DEFAULTS[key];

    // Copilot has no env var — detected only via gh CLI
    if (defaults.envVar && process.env[defaults.envVar]) {
      detected.push(key);
      continue;
    }

    // Check if the provider CLI is installed
    const cli = detectProviderCli(key);
    if (cli.available) {
      detected.push(key);
    }
  }

  return detected;
}
