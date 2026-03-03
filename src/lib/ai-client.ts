import https from 'node:https';
import { URL } from 'node:url';

import type { CollabConfig } from './config';
import type { Logger } from './logger';
import { loadTokens, isTokenExpired, refreshOAuthToken } from './oauth';
import { PROVIDER_DEFAULTS, type ProviderKey } from './providers';

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiCompletionOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AiClient {
  provider: ProviderKey;
  complete(messages: AiMessage[], options?: AiCompletionOptions): Promise<string>;
}

/**
 * Makes an HTTPS POST request and returns the response body as a string.
 */
function httpsPost(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs = 120_000,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);

    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode ?? 0, body: data });
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('AI API request timed out'));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Resolves the API key for a provider — from env var or OAuth tokens.
 */
async function resolveApiKey(
  provider: ProviderKey,
  config: CollabConfig,
  logger: Logger,
): Promise<string | null> {
  const defaults = PROVIDER_DEFAULTS[provider];

  // 1. Check environment variable
  const envKey = process.env[defaults.envVar];
  if (envKey) {
    return envKey;
  }

  // 2. Check OAuth tokens
  const tokens = loadTokens(config, provider);
  if (!tokens) {
    return null;
  }

  if (isTokenExpired(tokens)) {
    if (!tokens.refreshToken) {
      logger.warn(`OAuth token for ${defaults.label} is expired and no refresh token available.`);
      return null;
    }

    try {
      const oauthConfig = config.assistants?.providers?.[provider]?.auth?.oauth;
      if (!oauthConfig) {
        return null;
      }

      const clientId = process.env[oauthConfig.clientIdEnvVar ?? ''] ?? oauthConfig.clientId;
      const refreshed = await refreshOAuthToken(oauthConfig.tokenUrl, clientId, tokens.refreshToken);
      return refreshed.accessToken;
    } catch (err) {
      logger.warn(`Failed to refresh OAuth token for ${defaults.label}: ${err}`);
      return null;
    }
  }

  return tokens.accessToken;
}

// ---------- OpenAI ----------

function createOpenAiClient(apiKey: string): AiClient {
  return {
    provider: 'codex',
    async complete(messages, options = {}) {
      const model = options.model ?? PROVIDER_DEFAULTS.codex.models[0];
      const body = JSON.stringify({
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        max_completion_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature ?? 0.2,
      });

      const res = await httpsPost(
        'https://api.openai.com/v1/chat/completions',
        {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
        body,
      );

      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new Error(`OpenAI API error (${res.statusCode}): ${res.body}`);
      }

      const parsed = JSON.parse(res.body);
      return parsed.choices?.[0]?.message?.content ?? '';
    },
  };
}

// ---------- Anthropic ----------

function createAnthropicClient(apiKey: string): AiClient {
  return {
    provider: 'claude',
    async complete(messages, options = {}) {
      const model = options.model ?? PROVIDER_DEFAULTS.claude.models[0];

      // Anthropic API uses a system parameter, not a system message
      const systemMessage = messages.find((m) => m.role === 'system');
      const userMessages = messages.filter((m) => m.role !== 'system');

      const body = JSON.stringify({
        model,
        max_tokens: options.maxTokens ?? 4096,
        ...(systemMessage ? { system: systemMessage.content } : {}),
        messages: userMessages.map((m) => ({ role: m.role, content: m.content })),
      });

      const res = await httpsPost(
        'https://api.anthropic.com/v1/messages',
        {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          Accept: 'application/json',
        },
        body,
      );

      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new Error(`Anthropic API error (${res.statusCode}): ${res.body}`);
      }

      const parsed = JSON.parse(res.body);
      const textBlock = parsed.content?.find((b: { type: string }) => b.type === 'text');
      return textBlock?.text ?? '';
    },
  };
}

// ---------- Gemini ----------

function createGeminiClient(apiKey: string): AiClient {
  return {
    provider: 'gemini',
    async complete(messages, options = {}) {
      const model = options.model ?? PROVIDER_DEFAULTS.gemini.models[0];

      // Gemini uses a different message format
      const systemInstruction = messages.find((m) => m.role === 'system');
      const contents = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));

      const body = JSON.stringify({
        ...(systemInstruction
          ? { system_instruction: { parts: [{ text: systemInstruction.content }] } }
          : {}),
        contents,
        generationConfig: {
          maxOutputTokens: options.maxTokens ?? 4096,
          temperature: options.temperature ?? 0.2,
        },
      });

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const res = await httpsPost(url, { Accept: 'application/json' }, body);

      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new Error(`Gemini API error (${res.statusCode}): ${res.body}`);
      }

      const parsed = JSON.parse(res.body);
      return parsed.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    },
  };
}

// ---------- Factory ----------

const CLIENT_FACTORIES: Record<ProviderKey, (apiKey: string) => AiClient> = {
  codex: createOpenAiClient,
  claude: createAnthropicClient,
  gemini: createGeminiClient,
};

/**
 * Creates an AI client for the given provider, resolving auth automatically.
 * Returns null if no credentials are available.
 */
export async function createAiClient(
  provider: ProviderKey,
  config: CollabConfig,
  logger: Logger,
): Promise<AiClient | null> {
  const apiKey = await resolveApiKey(provider, config, logger);
  if (!apiKey) {
    return null;
  }

  return CLIENT_FACTORIES[provider](apiKey);
}

/**
 * Creates an AI client for the first available provider.
 * Tries providers in order: codex, claude, gemini.
 */
export async function createFirstAvailableClient(
  providers: ProviderKey[],
  config: CollabConfig,
  logger: Logger,
): Promise<AiClient | null> {
  for (const provider of providers) {
    const client = await createAiClient(provider, config, logger);
    if (client) {
      logger.info(`Using ${PROVIDER_DEFAULTS[provider].label} for repository analysis.`);
      return client;
    }
  }

  return null;
}
