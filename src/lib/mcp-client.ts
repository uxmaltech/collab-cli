import type { CollabConfig } from './config';
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

export function getMcpBaseUrl(config: CollabConfig): string {
  const env = loadRuntimeEnv(config);
  const host = env.MCP_HOST || '127.0.0.1';
  const port = env.MCP_PORT || '7337';
  return `http://${host}:${port}`;
}

export async function ingestDocuments(
  baseUrl: string,
  payload: IngestPayload,
  apiKey?: string,
): Promise<IngestResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${baseUrl}/api/v1/ingest`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`MCP ingest failed (${response.status}): ${body}`);
  }

  return (await response.json()) as IngestResult;
}

export async function triggerGraphSeed(
  baseUrl: string,
  apiKey?: string,
): Promise<SeedResult> {
  const headers: Record<string, string> = {};

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${baseUrl}/api/v1/seed/graph`, {
    method: 'POST',
    headers,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`MCP graph seed failed (${response.status}): ${body}`);
  }

  return (await response.json()) as SeedResult;
}
