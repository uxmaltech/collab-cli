import fs from 'node:fs';
import path from 'node:path';

import { isWorkspaceMode, resolveRepoConfigs } from '../lib/config';
import type { OrchestrationStage, StageContext } from '../lib/orchestrator';

/** Container name for the MCP service — matches the compose template. */
const MCP_CONTAINER = 'collab-mcp';

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
 * In workspace mode collects from shared uxmaltech + each repo's architecture.
 * In single-repo mode falls back to the existing architectureDir scan.
 */
function collectAllArchitectureFiles(ctx: StageContext): string[] {
  if (!isWorkspaceMode(ctx.config)) {
    return collectMarkdownFiles(ctx.config.architectureDir);
  }

  const files = [...collectMarkdownFiles(ctx.config.uxmaltechDir)];
  for (const rc of resolveRepoConfigs(ctx.config)) {
    files.push(...collectMarkdownFiles(rc.architectureRepoDir));
  }
  return files;
}

function ingestCanonFiles(ctx: StageContext): void {
  const files = collectAllArchitectureFiles(ctx);

  if (files.length === 0) {
    ctx.logger.info('No architecture files found to ingest.');
    return;
  }

  ctx.logger.info(`Ingesting ${files.length} architecture file(s) into MCP.`);

  // Pass file paths relative to the workspace so the MCP container
  // can resolve them via its mounted volume.
  const relativePaths = files.map((f) => path.relative(ctx.config.workspaceDir, f));

  // Use `docker exec` directly against the well-known container name so the
  // command succeeds regardless of which compose project started the container.
  ctx.executor.run('docker', [
    'exec', MCP_CONTAINER,
    'npm', 'run', 'ingest:v2', '--', '--files', ...relativePaths,
  ]);
}

export const canonIngestStage: OrchestrationStage = {
  id: 'canon-ingest',
  title: 'Ingest canonical architecture files into MCP',
  recovery: [
    'Ensure MCP and infra containers are running.',
    'Run collab init --resume to retry canon ingestion.',
  ],
  run: (ctx) => {
    if (ctx.executor.dryRun) {
      ctx.logger.info('[dry-run] Would ingest architecture files into MCP.');
      return;
    }

    ingestCanonFiles(ctx);
  },
};
