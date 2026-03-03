import fs from 'node:fs';
import path from 'node:path';

import { runDockerCompose } from '../lib/docker-compose';
import type { OrchestrationStage, StageContext } from '../lib/orchestrator';
import { resolveMcpComposeFile } from '../commands/mcp/shared';

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

function ingestCanonFiles(ctx: StageContext, mcpComposeFile: string): void {
  const files = collectMarkdownFiles(ctx.config.architectureDir);

  if (files.length === 0) {
    ctx.logger.info('No architecture files found to ingest.');
    return;
  }

  ctx.logger.info(`Ingesting ${files.length} architecture file(s) into MCP.`);

  // Pass file paths relative to the workspace so the MCP container
  // can resolve them via its mounted volume.
  const relativePaths = files.map((f) => path.relative(ctx.config.workspaceDir, f));

  runDockerCompose({
    executor: ctx.executor,
    files: [mcpComposeFile],
    arguments: ['exec', 'mcp', 'npm', 'run', 'ingest:v2', '--', '--files', ...relativePaths],
    cwd: ctx.config.workspaceDir,
  });
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

    const outputDir = ctx.options?.outputDir as string | undefined;
    const selection = resolveMcpComposeFile(ctx.config, outputDir, undefined);
    ingestCanonFiles(ctx, selection.filePath);
  },
};
