import https from 'node:https';
import { URL } from 'node:url';

import type { ProviderKey } from './providers';

export interface ModelInfo {
  id: string;
  name?: string;
}

function httpsGet(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 15_000,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);

    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: { Accept: 'application/json', ...headers },
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
      req.destroy(new Error('Model listing request timed out'));
    });

    req.on('error', reject);
    req.end();
  });
}

// ---------- Gemini ----------

async function listGeminiModels(apiKey: string): Promise<ModelInfo[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=100`;
  const res = await httpsGet(url);

  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`Gemini API error (${res.statusCode})`);
  }

  const parsed = JSON.parse(res.body) as {
    models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
  };
  const models = (parsed.models ?? []) as Array<{
    name: string;
    displayName?: string;
    supportedGenerationMethods?: string[];
  }>;

  return models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .filter((m) => m.name.includes('gemini'))
    .map((m) => ({
      id: m.name.replace('models/', ''),
      name: m.displayName,
    }));
}

// ---------- OpenAI ----------

async function listOpenAiModels(apiKey: string): Promise<ModelInfo[]> {
  const url = 'https://api.openai.com/v1/models';
  const res = await httpsGet(url, { Authorization: `Bearer ${apiKey}` });

  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`OpenAI API error (${res.statusCode})`);
  }

  const parsed = JSON.parse(res.body) as { data?: { id: string; owned_by?: string }[] };
  const models = (parsed.data ?? []) as Array<{ id: string; owned_by?: string }>;

  // Filter to chat/completion models, exclude fine-tuned, audio, realtime, embedding
  const chatPrefixes = ['gpt-4', 'gpt-3.5', 'o3', 'o4', 'o1'];
  const excludePatterns = ['realtime', 'audio', 'embed', 'tts', 'whisper', 'dall-e', 'davinci', 'babbage'];

  return models
    .filter((m) => chatPrefixes.some((p) => m.id.startsWith(p)))
    .filter((m) => !excludePatterns.some((e) => m.id.includes(e)))
    .map((m) => ({ id: m.id }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// ---------- Anthropic ----------

async function listAnthropicModels(apiKey: string): Promise<ModelInfo[]> {
  const url = 'https://api.anthropic.com/v1/models?limit=100';
  const res = await httpsGet(url, {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  });

  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`Anthropic API error (${res.statusCode})`);
  }

  const parsed = JSON.parse(res.body) as { data?: { id: string; display_name?: string }[] };
  const models = (parsed.data ?? []) as Array<{
    id: string;
    display_name?: string;
  }>;

  return models.map((m) => ({
    id: m.id,
    name: m.display_name,
  }));
}

// ---------- Public API ----------

/**
 * Lists available models from a provider's API.
 * Validates the API key in the process — throws on invalid key.
 */
export async function listModels(provider: ProviderKey, apiKey: string): Promise<ModelInfo[]> {
  switch (provider) {
    case 'gemini':
      return listGeminiModels(apiKey);
    case 'codex':
      return listOpenAiModels(apiKey);
    case 'claude':
      return listAnthropicModels(apiKey);
    case 'copilot':
      return [];
  }
}
