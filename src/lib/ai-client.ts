import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';

import type { CollabConfig } from './config';
import { loadApiKey } from './credentials';
import type { Logger } from './logger';
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
 * Resolves the API key for a provider.
 *
 * Resolution order:
 *   1. Environment variable (e.g. OPENAI_API_KEY)
 *   2. Stored credential from .collab/credentials.json
 */
function resolveApiKey(
  provider: ProviderKey,
  config: CollabConfig,
): string | null {
  const defaults = PROVIDER_DEFAULTS[provider];

  // 1. Check environment variable
  const envKey = process.env[defaults.envVar];
  if (envKey) {
    return envKey;
  }

  // 2. Check stored credentials
  const storedKey = loadApiKey(config, provider);
  if (storedKey) {
    return storedKey;
  }

  return null;
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

      const parsed = JSON.parse(res.body) as {
        choices?: { message?: { content?: string } }[];
      };
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

      const parsed = JSON.parse(res.body) as {
        content?: { type: string; text?: string }[];
      };
      const textBlock = parsed.content?.find((b) => b.type === 'text');
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

      const parsed = JSON.parse(res.body) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      return parsed.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    },
  };
}

// ---------- CLI-based clients ----------

/**
 * Combines system and user messages into a single prompt string
 * for CLI tools that don't support separate message roles.
 */
function buildCombinedPrompt(messages: AiMessage[]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      parts.push(msg.content);
    } else if (msg.role === 'user') {
      parts.push('---\n\n' + msg.content);
    } else if (msg.role === 'assistant') {
      parts.push('Assistant: ' + msg.content);
    }
  }

  return parts.join('\n\n');
}

/**
 * Executes codex CLI for completion using `codex exec`.
 */
function execCodexCli(prompt: string, model?: string): string {
  const tmpFile = path.join(os.tmpdir(), `collab-analysis-${Date.now()}.txt`);

  try {
    const args = [
      'exec',
      '--ephemeral',
      '--sandbox', 'read-only',
      '--skip-git-repo-check',
      '-o', tmpFile,
    ];

    if (model) {
      args.push('-m', model);
    }

    args.push(prompt);

    execFileSync('codex', args, {
      encoding: 'utf8',
      timeout: 300_000,
      stdio: ['ignore', 'inherit', 'inherit'],
    });

    if (fs.existsSync(tmpFile)) {
      return fs.readFileSync(tmpFile, 'utf8').trim();
    }

    return '';
  } finally {
    try {
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Executes claude CLI for completion using `claude -p`.
 */
function execClaudeCli(prompt: string, model?: string): string {
  const args = ['-p'];

  if (model) {
    args.push('--model', model);
  }

  args.push(prompt);

  const output = execFileSync('claude', args, {
    encoding: 'utf8',
    timeout: 300_000,
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  return output.trim();
}

/**
 * Executes gemini CLI for completion.
 */
function execGeminiCli(prompt: string, model?: string): string {
  const args: string[] = [];

  if (model) {
    args.push('--model', model);
  }

  args.push(prompt);

  const output = execFileSync('gemini', args, {
    encoding: 'utf8',
    timeout: 300_000,
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  return output.trim();
}

const CLI_EXECUTORS: Partial<Record<ProviderKey, (prompt: string, model?: string) => string>> = {
  codex: execCodexCli,
  claude: execClaudeCli,
  gemini: execGeminiCli,
};

/**
 * Creates an AI client that uses the provider's official CLI for completion.
 * This allows repo analysis to work without API keys.
 */
function createCliClient(provider: ProviderKey, model?: string): AiClient {
  return {
    provider,
    complete(messages, options = {}) {
      const effectiveModel = options.model ?? model;
      const prompt = buildCombinedPrompt(messages);
      const executor = CLI_EXECUTORS[provider];
      if (!executor) {
        throw new Error(`No CLI executor available for provider '${provider}'.`);
      }

      return Promise.resolve(executor(prompt, effectiveModel));
    },
  };
}

// ---------- Factory ----------

const CLIENT_FACTORIES: Partial<Record<ProviderKey, (apiKey: string) => AiClient>> = {
  codex: createOpenAiClient,
  claude: createAnthropicClient,
  gemini: createGeminiClient,
};

/**
 * Creates an AI client for the given provider, resolving auth automatically.
 *
 * Resolution order:
 *   1. API key (env var or stored credentials) → use HTTP API
 *   2. CLI auth configured with CLI available → use CLI executable
 *   3. null if neither available
 */
export function createAiClient(
  provider: ProviderKey,
  config: CollabConfig,
  logger: Logger,
): AiClient | null {
  // Copilot doesn't support AI completion — it works via GitHub issues
  if (provider === 'copilot') {
    return null;
  }

  // 1. Try API key first
  const factory = CLIENT_FACTORIES[provider];
  const apiKey = resolveApiKey(provider, config);
  if (apiKey && factory) {
    return factory(apiKey);
  }

  // 2. Try CLI auth if configured
  const providerConfig = config.assistants?.providers?.[provider];
  if (providerConfig?.auth?.method === 'cli' && providerConfig?.cli?.available) {
    const model = providerConfig.model ?? providerConfig.cli.configuredModel;
    logger.debug(`Using ${providerConfig.cli.command} CLI for ${PROVIDER_DEFAULTS[provider].label} completion.`);
    return createCliClient(provider, model);
  }

  return null;
}

/**
 * Creates an AI client for the first available provider.
 * Tries providers in order: codex, claude, gemini.
 */
export function createFirstAvailableClient(
  providers: ProviderKey[],
  config: CollabConfig,
  logger: Logger,
): AiClient | null {
  for (const provider of providers) {
    const client = createAiClient(provider, config, logger);
    if (client) {
      logger.info(`Using ${PROVIDER_DEFAULTS[provider].label} for repository analysis.`);
      return client;
    }
  }

  return null;
}
