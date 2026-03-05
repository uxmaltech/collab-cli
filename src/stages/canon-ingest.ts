import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { isWorkspaceMode, resolveRepoConfigs } from '../lib/config';
import { isBusinessCanonConfigured } from '../lib/canon-resolver';
import {
  getMcpBaseUrl,
  ingestDocuments,
  resolveMcpApiKey,
  resolveMcpHttpTimeoutMs,
  type IngestDocument,
  type IngestPayload,
  type IngestResult,
} from '../lib/mcp-client';
import { loadRuntimeEnv } from '../lib/service-health';
import type { OrchestrationStage, StageContext } from '../lib/orchestrator';

const MAX_DOCS_PER_REQUEST = 100;

interface RepoIdentity {
  organization: string;
  repo: string;
  scope: string;
}

/**
 * Recursively collects all `.md` files under a directory.
 */
function collectMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const results: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...collectMarkdownFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(full);
    }
  }

  return results;
}

/**
 * Reads files and produces IngestDocument objects with paths relative to a base.
 */
function filesToDocuments(files: string[], baseDir: string): IngestDocument[] {
  return files.map((f) => ({
    path: path.relative(baseDir, f),
    content: fs.readFileSync(f, 'utf8'),
  }));
}

function chunkDocuments(documents: IngestDocument[], batchSize: number): IngestDocument[][] {
  const chunks: IngestDocument[][] = [];
  for (let index = 0; index < documents.length; index += batchSize) {
    chunks.push(documents.slice(index, index + batchSize));
  }
  return chunks;
}

/**
 * Normalizes a repo identifier/url into an "owner/repo" slug when possible.
 */
function normalizeGitHubRepoSlug(repo: string): string {
  return repo
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/^ssh:\/\/git@github\.com\//i, '');
}

/**
 * Derives a scope name from a business canon repo slug.
 * e.g. "uxmaltech/my-app-architecture.git/" → "my-app-architecture"
 */
function businessScopeFromRepo(repo: string): string {
  const normalized = normalizeGitHubRepoSlug(repo);
  const scope = normalized.split('/').filter(Boolean).pop();
  return scope ?? normalized;
}

function parseRepoIdentityFromRemote(remoteUrl: string): RepoIdentity | undefined {
  if (!/github\.com[:/]/i.test(remoteUrl)) {
    return undefined;
  }

  const normalized = normalizeGitHubRepoSlug(remoteUrl);
  const [organization, repoName] = normalized.split('/').filter(Boolean);
  if (!organization || !repoName) {
    return undefined;
  }

  return {
    organization,
    repo: `${organization}/${repoName}`,
    scope: repoName,
  };
}

function sanitizeScope(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
  const scope = normalized.split('/').filter(Boolean).pop();
  return scope && scope.length > 0 ? scope : fallback;
}

function resolveRepoIdentity(repoDir: string, fallbackScope: string): RepoIdentity {
  try {
    const remoteUrl = execFileSync(
      'git',
      ['-C', repoDir, 'remote', 'get-url', 'origin'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();

    const fromRemote = parseRepoIdentityFromRemote(remoteUrl);
    if (fromRemote) {
      return fromRemote;
    }
  } catch {
    // Fallback below when repo has no git origin or git is unavailable.
  }

  const scope = sanitizeScope(fallbackScope, 'repo');
  return {
    organization: 'local',
    repo: `local/${scope}`,
    scope,
  };
}

async function ingestInBatches(
  baseUrl: string,
  payload: IngestPayload,
  apiKey: string | undefined,
  timeoutMs: number,
): Promise<IngestResult> {
  const chunks = chunkDocuments(payload.documents, MAX_DOCS_PER_REQUEST);
  let totalFiles = 0;
  let totalPoints = 0;
  let totalNodes = 0;
  let totalEdges = 0;
  let collection = '';
  let space = '';

  for (const documents of chunks) {
    const result = await ingestDocuments(baseUrl, { ...payload, documents }, apiKey, timeoutMs);
    totalFiles += result.vector.ingested_files;
    totalPoints += result.vector.total_points;
    totalNodes += result.graph.nodes_created;
    totalEdges += result.graph.edges_created;
    collection = collection || result.vector.collection;
    space = space || result.graph.space;
  }

  return {
    vector: {
      ingested_files: totalFiles,
      total_points: totalPoints,
      collection: collection || payload.scope,
    },
    graph: {
      nodes_created: totalNodes,
      edges_created: totalEdges,
      space: space || payload.scope,
    },
  };
}

export async function ingestCanonFiles(ctx: StageContext): Promise<void> {
  const baseUrl = getMcpBaseUrl(ctx.config);
  const env = loadRuntimeEnv(ctx.config);
  const apiKey = resolveMcpApiKey(env);
  const timeoutMs = resolveMcpHttpTimeoutMs(env);

  // --- Framework canon (uxmaltech) ---
  const uxmaltechFiles = collectMarkdownFiles(ctx.config.uxmaltechDir);

  if (uxmaltechFiles.length > 0) {
    ctx.logger.info(`Ingesting ${uxmaltechFiles.length} framework architecture file(s) via HTTP.`);

    const payload: IngestPayload = {
      context: 'technical',
      scope: 'uxmaltech',
      organization: 'uxmaltech',
      repo: 'uxmaltech/collab-architecture',
      documents: filesToDocuments(uxmaltechFiles, ctx.config.uxmaltechDir),
    };

    const result = await ingestInBatches(baseUrl, payload, apiKey, timeoutMs);
    ctx.logger.info(
      `Framework canon ingested: ${result.vector.ingested_files} files, ` +
        `${result.vector.total_points} vectors, ${result.graph.nodes_created} graph nodes.`,
    );
  } else {
    ctx.logger.info('No framework architecture files found to ingest.');
  }

  // --- Business canon ---
  if (isBusinessCanonConfigured(ctx.config)) {
    const localDir = ctx.config.canons?.business?.localDir ?? 'business';
    const businessDir = path.join(ctx.config.architectureDir, localDir);
    const businessFiles = collectMarkdownFiles(businessDir);

    if (businessFiles.length > 0) {
      const configuredBusinessRepo = ctx.config.canons!.business!.repo;
      const normalizedBusinessRepo = normalizeGitHubRepoSlug(configuredBusinessRepo);
      const businessScope = businessScopeFromRepo(normalizedBusinessRepo);
      const businessOrg = normalizedBusinessRepo.split('/')[0] ?? 'uxmaltech';
      const businessRepo = normalizedBusinessRepo.includes('/')
        ? normalizedBusinessRepo
        : `${businessOrg}/${normalizedBusinessRepo}`;

      ctx.logger.info(`Ingesting ${businessFiles.length} business architecture file(s) via HTTP.`);

      const payload: IngestPayload = {
        context: 'technical',
        scope: businessScope,
        organization: businessOrg,
        repo: businessRepo,
        documents: filesToDocuments(businessFiles, businessDir),
      };

      const result = await ingestInBatches(baseUrl, payload, apiKey, timeoutMs);
      ctx.logger.info(
        `Business canon ingested: ${result.vector.ingested_files} files, ` +
          `${result.vector.total_points} vectors, ${result.graph.nodes_created} graph nodes.`,
      );
    } else {
      ctx.logger.info('No business architecture files found to ingest.');
    }
  }

  // --- Repo architecture docs ---
  if (isWorkspaceMode(ctx.config)) {
    for (const rc of resolveRepoConfigs(ctx.config)) {
      const repoFiles = collectMarkdownFiles(rc.architectureRepoDir);
      if (repoFiles.length === 0) {
        continue;
      }

      const repoIdentity = resolveRepoIdentity(rc.repoDir, rc.name);
      ctx.logger.info(
        `Ingesting ${repoFiles.length} file(s) from repo ${repoIdentity.repo} via HTTP.`,
      );

      const payload: IngestPayload = {
        context: 'technical',
        scope: repoIdentity.scope,
        organization: repoIdentity.organization,
        repo: repoIdentity.repo,
        documents: filesToDocuments(repoFiles, rc.architectureRepoDir),
      };

      const result = await ingestInBatches(baseUrl, payload, apiKey, timeoutMs);
      ctx.logger.info(
        `Repo ${repoIdentity.repo} ingested: ${result.vector.ingested_files} files, ` +
          `${result.vector.total_points} vectors.`,
      );
    }
    return;
  }

  // Non-workspace mode: ingest local repo architecture docs (`docs/architecture/repo`).
  const repoFiles = collectMarkdownFiles(ctx.config.repoDir);
  if (repoFiles.length > 0) {
    const fallbackScope = path.basename(ctx.config.workspaceDir);
    const repoIdentity = resolveRepoIdentity(ctx.config.workspaceDir, fallbackScope);
    ctx.logger.info(
      `Ingesting ${repoFiles.length} file(s) from local repo architecture via HTTP.`,
    );

    const payload: IngestPayload = {
      context: 'technical',
      scope: repoIdentity.scope,
      organization: repoIdentity.organization,
      repo: repoIdentity.repo,
      documents: filesToDocuments(repoFiles, ctx.config.repoDir),
    };

    const result = await ingestInBatches(baseUrl, payload, apiKey, timeoutMs);
    ctx.logger.info(
      `Repo architecture ingested: ${result.vector.ingested_files} files, ` +
        `${result.vector.total_points} vectors.`,
    );
  }
}

export const canonIngestStage: OrchestrationStage = {
  id: 'canon-ingest',
  title: 'Ingest canonical architecture files into MCP',
  recovery: [
    'Ensure MCP service is running and accessible.',
    'Run collab init --resume to retry canon ingestion.',
  ],
  run: async (ctx) => {
    if (ctx.executor.dryRun) {
      ctx.logger.info('[dry-run] Would ingest architecture files into MCP via HTTP.');
      return;
    }

    await ingestCanonFiles(ctx);
  },
};
