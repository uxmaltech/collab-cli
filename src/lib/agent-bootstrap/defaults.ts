import type { ProviderKey } from '../providers';

export const DEFAULT_PROVIDER: ProviderKey = 'gemini';
export const DEFAULT_RUNTIME_SOURCE = 'https://github.com/uxmaltech/collab-agent-runtime';
export const DEFAULT_MCP_URL = 'http://127.0.0.1:8787/mcp';
export const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379';
export const DEFAULT_WORKER_NAMESPACES = ['context.*', 'agent.*'] as const;
export const DEFAULT_OPERATOR_NAMESPACES = ['admin.recovery.*'] as const;

const DEFAULT_EGRESS_URLS: Record<ProviderKey, string[]> = {
  codex: ['https://api.github.com', 'https://api.openai.com'],
  claude: ['https://api.github.com', 'https://api.anthropic.com'],
  gemini: ['https://api.github.com', 'https://generativelanguage.googleapis.com'],
  copilot: ['https://api.github.com'],
};

export function slugifyAgentName(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return slug || 'collab-agent';
}

export function humanizeAgentSlug(slug: string): string {
  return slug
    .split('-')
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ') || 'Collab Agent';
}

export function parseCsvList(value: string | undefined, fallback: readonly string[] = []): string[] {
  const source = value === undefined ? [...fallback] : value.split(',');

  const items = source
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return [...new Set(items)];
}

export function parseMergedList(
  listValue: string | undefined,
  repeatedValues: readonly string[] | undefined,
  fallback: readonly string[] = [],
): string[] {
  const merged = [
    ...parseCsvList(listValue),
    ...((repeatedValues ?? []).map((item) => item.trim()).filter((item) => item.length > 0)),
  ];

  if (merged.includes('*')) {
    return ['*'];
  }

  return merged.length > 0 ? [...new Set(merged)] : [...fallback];
}

export function defaultEgressUrls(provider: ProviderKey): string[] {
  return [...DEFAULT_EGRESS_URLS[provider]];
}
