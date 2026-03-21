import type { CollabConfig } from './config';
import type { IngestAstPayload, IngestMarkdownPayload } from './ingest/types';
import { loadRuntimeEnv } from './service-health';

export interface IngestDocument {
  path: string;
  content: string;
}

export interface IngestPayload {
  context: string;
  scope: string;
  organization: string;
  repo: string;
  documents: IngestDocument[];
}

export interface IngestVectorResult {
  ingested_files: number;
  total_points: number;
  collection: string;
}

export interface IngestGraphResult {
  nodes_created: number;
  edges_created: number;
  space: string;
}

export interface IngestResult {
  vector: IngestVectorResult;
  graph: IngestGraphResult;
}

export interface SeedResult {
  status: string;
  nodes_created: number;
  edges_created: number;
}

const DEFAULT_MCP_HTTP_TIMEOUT_MS = 30_000;
/** Heavier operations (seed, ingest) get a longer default timeout. */
const DEFAULT_MCP_HEAVY_TIMEOUT_MS = 120_000;

function parseTimeoutMs(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  operation: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${operation} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function resolveMcpHttpTimeoutMs(env: Record<string, string | undefined>): number {
  return parseTimeoutMs(env.MCP_HTTP_TIMEOUT_MS, DEFAULT_MCP_HTTP_TIMEOUT_MS);
}

/**
 * Like `resolveMcpHttpTimeoutMs` but uses a longer fallback (120 s) for heavy
 * operations such as graph seeding and document ingestion.
 */
export function resolveMcpHeavyTimeoutMs(env: Record<string, string | undefined>): number {
  return parseTimeoutMs(env.MCP_HTTP_TIMEOUT_MS, DEFAULT_MCP_HEAVY_TIMEOUT_MS);
}

export function resolveMcpApiKey(env: Record<string, string | undefined>): string | undefined {
  const explicit = env.MCP_API_KEY?.trim();
  if (explicit) {
    return explicit;
  }

  const firstFromList = env.MCP_API_KEYS
    ?.split(/[,\s]+/)
    .map((key) => key.trim())
    .find((key) => key.length > 0);

  return firstFromList || undefined;
}

export function getMcpBaseUrl(config: CollabConfig): string {
  // Remote infra: use the explicitly configured URL.
  if (config.mcpUrl) {
    return config.mcpUrl;
  }

  // Local infra: derive from .env or defaults.
  const env = loadRuntimeEnv(config);
  const host = env.MCP_HOST || '127.0.0.1';
  const port = env.MCP_PORT || '7337';
  return `http://${host}:${port}`;
}

export async function ingestDocuments(
  baseUrl: string,
  payload: IngestPayload,
  apiKey?: string,
  timeoutMs = DEFAULT_MCP_HEAVY_TIMEOUT_MS,
): Promise<IngestResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetchWithTimeout(`${baseUrl}/api/v1/ingest`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  }, timeoutMs, 'MCP ingest request');

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`MCP ingest failed (${response.status}): ${body}`);
  }

  return (await response.json()) as IngestResult;
}

export async function triggerGraphSeed(
  baseUrl: string,
  apiKey?: string,
  timeoutMs = DEFAULT_MCP_HEAVY_TIMEOUT_MS,
): Promise<SeedResult> {
  const headers: Record<string, string> = {};

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetchWithTimeout(`${baseUrl}/api/v1/seed/graph`, {
    method: 'POST',
    headers,
  }, timeoutMs, 'MCP graph seed request');

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`MCP graph seed failed (${response.status}): ${body}`);
  }

  return (await response.json()) as SeedResult;
}

export interface IngestAstResult {
  nodes_created: number;
  edges_created: number;
  space: string;
}

export async function ingestAst(
  baseUrl: string,
  payload: IngestAstPayload,
  apiKey?: string,
  timeoutMs = DEFAULT_MCP_HTTP_TIMEOUT_MS,
): Promise<IngestAstResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetchWithTimeout(`${baseUrl}/api/v1/ingest/ast`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  }, timeoutMs, 'MCP AST ingest request');

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`MCP AST ingest failed (${response.status}): ${body}`);
  }

  return (await response.json()) as IngestAstResult;
}

export interface IngestMarkdownResult {
  ingested_files: number;
  total_points: number;
  collection: string;
}

export async function ingestMarkdown(
  baseUrl: string,
  payload: IngestMarkdownPayload,
  apiKey?: string,
  timeoutMs = DEFAULT_MCP_HTTP_TIMEOUT_MS,
): Promise<IngestMarkdownResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetchWithTimeout(`${baseUrl}/api/v1/ingest/markdown`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  }, timeoutMs, 'MCP markdown ingest request');

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`MCP markdown ingest failed (${response.status}): ${body}`);
  }

  return (await response.json()) as IngestMarkdownResult;
}
