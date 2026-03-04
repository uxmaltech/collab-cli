import fs from 'node:fs';
import path from 'node:path';

import { isWorkspaceMode, resolveRepoConfigs } from '../lib/config';
import { isBusinessCanonConfigured } from '../lib/canon-resolver';
import { getMcpBaseUrl, ingestDocuments, type IngestDocument, type IngestPayload } from '../lib/mcp-client';
import { loadRuntimeEnv } from '../lib/service-health';
import type { OrchestrationStage, StageContext } from '../lib/orchestrator';

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

/**
 * Derives a scope name from a business canon repo slug.
 * e.g. "uxmaltech/my-app-architecture" → "my-app-architecture"
 */
function businessScopeFromRepo(repo: string): string {
  return repo.split('/').pop() ?? repo;
}

async function ingestCanonFiles(ctx: StageContext): Promise<void> {
  const baseUrl = getMcpBaseUrl(ctx.config);
  const env = loadRuntimeEnv(ctx.config);
  const apiKey = env.MCP_API_KEYS || undefined;

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

    const result = await ingestDocuments(baseUrl, payload, apiKey);
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
      const businessRepo = ctx.config.canons!.business!.repo;
      const businessScope = businessScopeFromRepo(businessRepo);

      ctx.logger.info(`Ingesting ${businessFiles.length} business architecture file(s) via HTTP.`);

      const payload: IngestPayload = {
        context: 'technical',
        scope: businessScope,
        organization: businessRepo.split('/')[0] ?? 'uxmaltech',
        repo: businessRepo,
        documents: filesToDocuments(businessFiles, businessDir),
      };

      const result = await ingestDocuments(baseUrl, payload, apiKey);
      ctx.logger.info(
        `Business canon ingested: ${result.vector.ingested_files} files, ` +
          `${result.vector.total_points} vectors, ${result.graph.nodes_created} graph nodes.`,
      );
    } else {
      ctx.logger.info('No business architecture files found to ingest.');
    }
  }

  // --- Workspace repos ---
  if (isWorkspaceMode(ctx.config)) {
    for (const rc of resolveRepoConfigs(ctx.config)) {
      const repoFiles = collectMarkdownFiles(rc.architectureRepoDir);
      if (repoFiles.length > 0) {
        ctx.logger.info(`Ingesting ${repoFiles.length} file(s) from repo ${rc.name} via HTTP.`);

        const payload: IngestPayload = {
          context: 'technical',
          scope: rc.name,
          organization: 'uxmaltech',
          repo: `uxmaltech/${rc.name}`,
          documents: filesToDocuments(repoFiles, rc.architectureRepoDir),
        };

        const result = await ingestDocuments(baseUrl, payload, apiKey);
        ctx.logger.info(
          `Repo ${rc.name} ingested: ${result.vector.ingested_files} files, ` +
            `${result.vector.total_points} vectors.`,
        );
      }
    }
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
