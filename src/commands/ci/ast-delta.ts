import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';

import type { CommandContext } from '../../lib/command-context';
import { detectLanguage, classifyContentKind, heuristicallyExtractSymbols } from '../../lib/ingest/code-metadata';
import { MAX_DOCUMENTS_PER_BATCH } from '../../lib/ingest/constants';
import { extractFile, isSupported, mergeExtractions } from '../../lib/ingest/extractor';
import { filterChangedSourceFiles } from '../../lib/ingest/file-filter';
import { detectPlatform } from '../../lib/ingest/platform-detector';
import { resolveRepoIdentity } from '../../lib/ingest/repo-identity';
import { chunkTextWithRanges } from '../../lib/ingest/text';
import type { AstEdge, AstNode, ExtractionResult, IngestAstPayload, IngestMarkdownDocument, IngestMarkdownPayload } from '../../lib/ingest/types';
import { getMcpBaseUrl, ingestAst, ingestMarkdown, resolveMcpApiKey, resolveMcpHttpTimeoutMs } from '../../lib/mcp-client';
import { loadRuntimeEnv } from '../../lib/service-health';

interface AstDeltaOptions {
  base?: string;
}

export function registerAstDeltaCommand(ci: Command): void {
  ci
    .command('ast-delta')
    .description('Extract AST from files changed since a base commit and ingest into MCP')
    .option('--base <sha>', 'Base commit SHA to diff against (default: HEAD~1)')
    .action(async (options: AstDeltaOptions, command: Command) => {
      const { createCommandContext } = await import('../../lib/command-context');
      const context = createCommandContext(command);
      await runAstDelta(context, options);
    });
}

async function runAstDelta(context: CommandContext, options: AstDeltaOptions): Promise<void> {
  const { cwd, logger } = context;
  const baseSha = options.base || 'HEAD~1';

  // 1. Get changed files via git diff
  let changedFiles: string[];
  try {
    const output = execFileSync(
      'git',
      ['diff', '--name-only', '--diff-filter=ACMR', baseSha],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    changedFiles = output ? output.split('\n').filter(Boolean) : [];
  } catch (err) {
    throw new Error(
      `Unable to compute changed files from ${baseSha}. Ensure the base commit is fetched (fetch-depth: 0): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (changedFiles.length === 0) {
    logger.info('No changed files detected; nothing to extract.');
    return;
  }

  // 2. Filter to supported source files (shared filter with repo-ingest)
  const sourceFiles = filterChangedSourceFiles(cwd, changedFiles);

  logger.info(`Changed files: ${changedFiles.length} total, ${sourceFiles.length} supported source files.`);

  if (sourceFiles.length === 0) {
    logger.info('No supported source files changed; nothing to extract.');
    return;
  }

  // 3. Resolve repo identity
  const repoName = path.basename(cwd);
  const platform = detectPlatform(cwd);
  const identity = resolveRepoIdentity(cwd, repoName);
  const isLaravel = platform === 'laravel';

  logger.info(`Repository: ${identity.repo} (${platform})`);

  // 4. AST extraction on changed files
  const extractions: ExtractionResult[] = [];
  let astSkipped = 0;
  let astErrors = 0;

  for (const relativePath of sourceFiles) {
    const language = detectLanguage(relativePath);
    if (!isSupported(language)) {
      astSkipped++;
      continue;
    }

    const fullPath = path.join(cwd, relativePath);
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
        logger.warn(result.warning);
      }
      extractions.push(result);
    } catch (err) {
      astErrors++;
      logger.warn(`AST extraction failed for ${relativePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const merged = mergeExtractions(extractions);
  logger.info(
    `AST extraction: ${merged.nodes.length} nodes, ${merged.edges.length} edges` +
      ` (${extractions.length} parsed, ${astSkipped} skipped, ${astErrors} errors)`,
  );

  // 5. Document chunking on changed files
  const documents: IngestMarkdownDocument[] = [];

  for (const relativePath of sourceFiles) {
    const fullPath = path.join(cwd, relativePath);
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

  logger.info(`Document chunking: ${documents.length} chunk(s) from ${sourceFiles.length} file(s).`);

  // 6. Resolve MCP connection (env vars for CI, collab config for local)
  const env = loadRuntimeEnv(context.config);
  const baseUrl = process.env.MCP_BASE_URL || getMcpBaseUrl(context.config);
  const apiKey = process.env.MCP_API_KEY || resolveMcpApiKey(env);
  const timeoutMs = resolveMcpHttpTimeoutMs(env);

  // 7. Ingest AST (isolated delta scope to avoid polluting canonical graph)
  const deltaScope = `delta/${identity.scope}`;
  let astIngested = false;
  if (merged.nodes.length > 0 || merged.edges.length > 0) {
    const astPayload: IngestAstPayload = {
      context: 'technical',
      scope: deltaScope,
      organization: identity.organization,
      repo: identity.repo,
      nodes: merged.nodes,
      edges: merged.edges,
    };

    try {
      const result = await ingestAst(baseUrl, astPayload, apiKey, timeoutMs);
      logger.info(`AST ingested: ${result.nodes_created} nodes, ${result.edges_created} edges (space: ${result.space})`);
      astIngested = true;
    } catch (err) {
      logger.warn(`AST ingestion failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 8. Ingest documents (batched, isolated delta scope)
  let docIngested = false;
  if (documents.length > 0) {
    try {
      let totalIngested = 0;
      let totalPoints = 0;

      for (let i = 0; i < documents.length; i += MAX_DOCUMENTS_PER_BATCH) {
        const batch = documents.slice(i, i + MAX_DOCUMENTS_PER_BATCH);
        const payload: IngestMarkdownPayload = {
          context: 'technical',
          scope: deltaScope,
          organization: identity.organization,
          repo: identity.repo,
          documents: batch,
        };
        const result = await ingestMarkdown(baseUrl, payload, apiKey, timeoutMs);
        totalIngested += result.ingested_files;
        totalPoints += result.total_points;
      }

      logger.info(`Documents ingested: ${totalIngested} files, ${totalPoints} vectors`);
      docIngested = true;
    } catch (err) {
      logger.warn(`Document ingestion failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 9. Write GitHub Actions job summary and PR impact comment
  writeSummary(changedFiles.length, sourceFiles.length, merged, documents, astIngested || docIngested);
  writeImpactComment(merged);
}

function writeSummary(
  totalChanged: number,
  sourceCount: number,
  merged: ReturnType<typeof mergeExtractions>,
  documents: IngestMarkdownDocument[],
  ingested: boolean,
): void {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) return;

  const lines = [
    '## AST Delta Extraction',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Changed files | ${totalChanged} |`,
    `| Source files processed | ${sourceCount} |`,
    `| AST nodes | ${merged.nodes.length} |`,
    `| AST edges | ${merged.edges.length} |`,
    `| Document chunks | ${documents.length} |`,
    `| Ingested to MCP | ${ingested ? 'yes' : 'no'} |`,
  ];

  try {
    fs.appendFileSync(summaryFile, lines.join('\n') + '\n');
  } catch {
    // Ignore — GITHUB_STEP_SUMMARY may not be writable outside CI
  }
}

function shortenId(id: string): string {
  const parts = id.split('::');
  return parts[parts.length - 1] || id;
}

export function writeImpactComment(
  merged: { nodes: AstNode[]; edges: AstEdge[] },
): void {
  const impactFile = process.env.AST_IMPACT_FILE;
  if (!impactFile) return;
  if (merged.nodes.length === 0 && merged.edges.length === 0) return;

  const lines: string[] = ['## Architecture Impact', ''];

  // Nodes table
  if (merged.nodes.length > 0) {
    lines.push(`### Nodes (${merged.nodes.length})`, '');
    lines.push('| Type | Name | File |');
    lines.push('|------|------|------|');
    for (const node of merged.nodes) {
      const name = String(node.properties.name || shortenId(node.id));
      const file = String(node.properties.path || '');
      lines.push(`| ${node.tag} | ${name} | ${file} |`);
    }
    lines.push('');
  }

  // Edges table
  if (merged.edges.length > 0) {
    lines.push(`### Edges (${merged.edges.length})`, '');
    lines.push('| Type | From | To |');
    lines.push('|------|------|-----|');
    for (const edge of merged.edges) {
      lines.push(`| ${edge.type} | ${shortenId(edge.from)} | ${shortenId(edge.to)} |`);
    }
    lines.push('');
  }

  // Files affected (collapsible)
  const fileCounts = new Map<string, number>();
  for (const node of merged.nodes) {
    const file = String(node.properties.path || 'unknown');
    fileCounts.set(file, (fileCounts.get(file) || 0) + 1);
  }

  if (fileCounts.size > 0) {
    lines.push('<details>');
    lines.push(`<summary>Files affected (${fileCounts.size})</summary>`, '');
    for (const [file, count] of [...fileCounts.entries()].sort()) {
      lines.push(`- ${file}: ${count} node${count !== 1 ? 's' : ''}`);
    }
    lines.push('', '</details>');
  }

  try {
    fs.writeFileSync(impactFile, lines.join('\n') + '\n');
  } catch {
    // Best-effort — may not be writable outside CI
  }
}
