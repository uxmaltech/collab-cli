import fs from 'node:fs';
import path from 'node:path';

import { detectLanguage, classifyContentKind, heuristicallyExtractSymbols } from '../lib/ingest/code-metadata';
import { EXCLUDED_DIRS, MAX_DOCUMENTS_PER_BATCH, MAX_FILE_SIZE_BYTES, SOURCE_EXTENSIONS } from '../lib/ingest/constants';
import { extractFile, isSupported, mergeExtractions } from '../lib/ingest/extractor';
import { detectPlatform } from '../lib/ingest/platform-detector';
import { resolveRepoIdentity } from '../lib/ingest/repo-identity';
import { chunkTextWithRanges } from '../lib/ingest/text';
import type {
  ExtractionResult,
  IngestAstPayload,
  IngestMarkdownDocument,
  IngestMarkdownPayload,
} from '../lib/ingest/types';
import {
  getMcpBaseUrl,
  ingestAst,
  ingestMarkdown,
  resolveMcpApiKey,
  resolveMcpHttpTimeoutMs,
} from '../lib/mcp-client';
import type { OrchestrationStage, StageContext } from '../lib/orchestrator';
import { loadRuntimeEnv } from '../lib/service-health';
import { withSpinner } from '../lib/spinner';

function collectSourceFiles(dir: string, baseDir: string): string[] {
  const results: string[] = [];

  function walk(currentDir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) {
          walk(full);
        }
        continue;
      }

      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (!SOURCE_EXTENSIONS.has(ext) && !entry.name.toLowerCase().startsWith('dockerfile')) {
        continue;
      }

      try {
        const stat = fs.statSync(full);
        if (stat.size > MAX_FILE_SIZE_BYTES) continue;
      } catch {
        continue;
      }

      results.push(path.relative(baseDir, full));
    }
  }

  walk(dir);
  return results;
}

export async function runRepoIngest(ctx: StageContext): Promise<void> {
  const repoPath = ctx.options?._repoPath as string | undefined;
  if (!repoPath) {
    ctx.logger.warn('No repo path provided; skipping AST ingestion.');
    return;
  }

  const repoName = path.basename(repoPath);
  const platform = detectPlatform(repoPath);
  const identity = resolveRepoIdentity(repoPath, repoName);
  const isLaravel = platform === 'laravel';

  ctx.logger.info(`Platform detected: ${platform}`);
  ctx.logger.info(`Repository identity: ${identity.repo}`);

  // 1. Collect source files
  const sourceFiles = collectSourceFiles(repoPath, repoPath);
  ctx.logger.info(`Found ${sourceFiles.length} source file(s) to process.`);

  if (sourceFiles.length === 0) {
    ctx.logger.warn('No source files found; skipping ingestion.');
    return;
  }

  // 2. AST extraction for supported languages (skippable via --skip-ast-generation)
  const skipAst = Boolean(ctx.options?.skipAstGeneration);
  let merged = mergeExtractions([]);

  if (skipAst) {
    ctx.logger.info('Skipping AST extraction by user choice (--skip-ast-generation).');
  } else {
    const extractions: ExtractionResult[] = [];
    let astSkipped = 0;
    let astErrors = 0;

    const astExtractionWork = async (): Promise<void> => {
      for (const relativePath of sourceFiles) {
        const language = detectLanguage(relativePath);
        if (!isSupported(language)) {
          astSkipped++;
          continue;
        }

        const fullPath = path.join(repoPath, relativePath);
        let sourceText: string;
        try {
          sourceText = fs.readFileSync(fullPath, 'utf8');
        } catch {
          astErrors++;
          continue;
        }

        try {
          const result = await extractFile({
            repo: identity.repo,
            platform,
            sourcePath: relativePath,
            sourceText,
            language,
            laravel: isLaravel,
          });

          if (result.warning) {
            ctx.logger.warn(result.warning);
          }

          extractions.push(result);
        } catch (err) {
          astErrors++;
          ctx.logger.warn(
            `AST extraction failed for ${relativePath}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    };

    await withSpinner(
      'Extracting AST from source files...',
      astExtractionWork,
      ctx.logger.verbosity === 'quiet',
    );

    merged = mergeExtractions(extractions);
    ctx.logger.info(
      `AST extraction complete: ${merged.nodes.length} nodes, ${merged.edges.length} edges` +
        ` (${extractions.length} files parsed, ${astSkipped} skipped, ${astErrors} errors)`,
    );
  }

  // 3. Chunk all source files for document ingestion
  const documents: IngestMarkdownDocument[] = [];

  for (const relativePath of sourceFiles) {
    const fullPath = path.join(repoPath, relativePath);
    let content: string;
    try {
      content = fs.readFileSync(fullPath, 'utf8');
    } catch {
      continue;
    }

    const language = detectLanguage(relativePath);
    const symbols = heuristicallyExtractSymbols({ language, sourceText: content });
    const contentKind = classifyContentKind({ sourcePath: relativePath, language, symbols });

    const chunks = chunkTextWithRanges(content);
    for (const chunk of chunks) {
      documents.push({
        path: `${relativePath}:${chunk.startLine}-${chunk.endLine}`,
        content: chunk.text,
        language,
        contentKind,
      });
    }
  }

  ctx.logger.info(`Document chunking complete: ${documents.length} chunk(s) from ${sourceFiles.length} file(s).`);

  // 4. Dry-run: log stats and stop
  if (ctx.executor.dryRun) {
    ctx.logger.info('[dry-run] Would send AST and documents to MCP.');
    ctx.logger.info(`[dry-run] AST: ${merged.nodes.length} nodes, ${merged.edges.length} edges`);
    ctx.logger.info(`[dry-run] Documents: ${documents.length} chunks`);
    return;
  }

  // 5. Send to MCP
  const baseUrl = getMcpBaseUrl(ctx.config);
  const env = loadRuntimeEnv(ctx.config);
  const apiKey = resolveMcpApiKey(env);
  const timeoutMs = resolveMcpHttpTimeoutMs(env);

  // 5a. AST ingestion
  if (merged.nodes.length > 0 || merged.edges.length > 0) {
    const astPayload: IngestAstPayload = {
      context: 'technical',
      scope: identity.scope,
      organization: identity.organization,
      repo: identity.repo,
      nodes: merged.nodes,
      edges: merged.edges,
    };

    try {
      const astResult = await withSpinner(
        `Ingesting AST (${merged.nodes.length} nodes, ${merged.edges.length} edges)...`,
        () => ingestAst(baseUrl, astPayload, apiKey, timeoutMs),
        ctx.logger.verbosity === 'quiet',
      );
      ctx.logger.info(
        `AST ingested: ${astResult.nodes_created} nodes, ${astResult.edges_created} edges (space: ${astResult.space})`,
      );
    } catch (err) {
      ctx.logger.warn(
        `AST ingestion failed (MCP endpoint may not be available yet): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 5b. Document ingestion (in batches)
  if (documents.length > 0) {
    try {
      let totalIngested = 0;
      let totalPoints = 0;
      let collection = '';

      const ingestWork = async (): Promise<void> => {
        for (let i = 0; i < documents.length; i += MAX_DOCUMENTS_PER_BATCH) {
          const batch = documents.slice(i, i + MAX_DOCUMENTS_PER_BATCH);
          const payload: IngestMarkdownPayload = {
            context: 'technical',
            scope: identity.scope,
            organization: identity.organization,
            repo: identity.repo,
            documents: batch,
          };

          const result = await ingestMarkdown(baseUrl, payload, apiKey, timeoutMs);
          totalIngested += result.ingested_files;
          totalPoints += result.total_points;
          collection = collection || result.collection;
        }
      };

      await withSpinner(
        `Ingesting ${documents.length} document chunk(s)...`,
        ingestWork,
        ctx.logger.verbosity === 'quiet',
      );

      ctx.logger.info(
        `Documents ingested: ${totalIngested} files, ${totalPoints} vectors (collection: ${collection})`,
      );
    } catch (err) {
      ctx.logger.warn(
        `Document ingestion failed (MCP endpoint may not be available yet): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export function buildRepoIngestStage(): OrchestrationStage {
  return {
    id: 'repo-ingest',
    title: 'Extract AST and ingest source into MCP',
    recovery: [
      'Ensure MCP service is running and accessible.',
      'Check that tree-sitter WASM grammars are installed (web-tree-sitter, tree-sitter-php, tree-sitter-typescript).',
      'Run collab init repos <package> --resume to retry ingestion.',
    ],
    run: runRepoIngest,
  };
}
