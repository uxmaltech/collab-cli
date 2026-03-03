import type { CollabConfig } from './config';

export const PROVIDER_KEYS = ['codex', 'claude', 'gemini'] as const;

export type ProviderKey = (typeof PROVIDER_KEYS)[number];

export type AuthMethod = 'api-key' | 'oauth';

export interface OAuthProviderConfig {
  clientId: string;
  clientIdEnvVar?: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  tokenFile: string;
}

export interface ProviderAuthConfig {
  method: AuthMethod;
  envVar?: string;
  oauth?: OAuthProviderConfig;
}

export interface ProviderConfig {
  enabled: boolean;
  auth: ProviderAuthConfig;
  model?: string;
}

export interface AssistantsConfig {
  providers: Partial<Record<ProviderKey, ProviderConfig>>;
}

export interface ProviderDefaults {
  label: string;
  description: string;
  envVar: string;
  models: string[];
  authMethods: readonly AuthMethod[];
  oauth: {
    authorizationUrl: string;
    tokenUrl: string;
    scopes: string[];
    clientIdEnvVar: string;
  };
}

export const PROVIDER_DEFAULTS: Record<ProviderKey, ProviderDefaults> = {
  codex: {
    label: 'Codex (OpenAI)',
    description: 'OpenAI models via API key or OAuth',
    envVar: 'OPENAI_API_KEY',
    models: ['o3-pro', 'gpt-4.1', 'o4-mini'],
    authMethods: ['api-key', 'oauth'],
    oauth: {
      authorizationUrl: 'https://auth.openai.com/authorize',
      tokenUrl: 'https://auth.openai.com/oauth/token',
      scopes: ['openai.organization.read', 'openai.completions.create'],
      clientIdEnvVar: 'OPENAI_CLIENT_ID',
    },
  },
  claude: {
    label: 'Claude (Anthropic)',
    description: 'Anthropic models via API key or OAuth',
    envVar: 'ANTHROPIC_API_KEY',
    models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-35-20241022'],
    authMethods: ['api-key', 'oauth'],
    oauth: {
      authorizationUrl: 'https://console.anthropic.com/oauth/authorize',
      tokenUrl: 'https://console.anthropic.com/oauth/token',
      scopes: ['messages.create'],
      clientIdEnvVar: 'ANTHROPIC_CLIENT_ID',
    },
  },
  gemini: {
    label: 'Gemini (Google)',
    description: 'Google AI models via API key or OAuth',
    envVar: 'GOOGLE_AI_API_KEY',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    authMethods: ['api-key', 'oauth'],
    oauth: {
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: ['https://www.googleapis.com/auth/generative-language'],
      clientIdEnvVar: 'GOOGLE_CLIENT_ID',
    },
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

export function autoDetectProviders(): ProviderKey[] {
  const detected: ProviderKey[] = [];

  for (const key of PROVIDER_KEYS) {
    const defaults = PROVIDER_DEFAULTS[key];
    if (process.env[defaults.envVar] || process.env[defaults.oauth.clientIdEnvVar]) {
      detected.push(key);
    }
  }

  return detected;
}
