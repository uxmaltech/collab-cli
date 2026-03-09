import fs from 'node:fs';
import path from 'node:path';

import { createFirstAvailableClient, type AiMessage } from '../lib/ai-client';
import {
  getBusinessCanonDir,
  isBusinessCanonConfigured,
  syncBusinessCanon,
} from '../lib/canon-resolver';
import {
  buildDomainGenPrompt,
  parseDomainGenerationResponse,
  writeDomainFiles,
  findNextIds,
  generateDomainGraphSeed,
  appendGraphSeed,
  type DomainGenerationResult,
} from '../lib/domain-gen';
import { CliError } from '../lib/errors';
import { loadGitHubAuth } from '../lib/github-auth';
import {
  getMcpBaseUrl,
  ingestDocuments,
  resolveMcpApiKey,
  resolveMcpHttpTimeoutMs,
  triggerGraphSeed,
  type IngestDocument,
} from '../lib/mcp-client';
import type { OrchestrationStage } from '../lib/orchestrator';
import { getEnabledProviders, type ProviderKey } from '../lib/providers';
import { scanRepository } from '../lib/repo-scanner';
import { loadRuntimeEnv } from '../lib/service-health';
import { withSpinner } from '../lib/spinner';

// ────────────────────────────────────────────────────────────────
// Helper: collect markdown files recursively
// ────────────────────────────────────────────────────────────────

/** Recursively collects all `.md` file paths under the given directory. */
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

// ────────────────────────────────────────────────────────────────
// Shared stage: domain-analysis (used by both file-only & indexed)
// ────────────────────────────────────────────────────────────────

/** Builds the AI-driven domain analysis stage shared by both pipelines. */
function buildDomainAnalysisStage(): OrchestrationStage {
  return {
    id: 'domain-analysis',
    title: 'Analyze repository and generate domain definition',
    recovery: [
      'Ensure an AI provider is configured (OPENAI_API_KEY, claude CLI, etc.).',
      'Run collab init repos <package> --resume to retry analysis.',
    ],
    run: async (ctx) => {
      const repoPath = ctx.options?._repoPath as string;
      if (!repoPath) {
        throw new CliError('No repo path provided for domain analysis.');
      }

      // Resume support: check for cached result from a previous run
      const cacheFile = path.join(ctx.config.collabDir, 'domain-gen-result.json');
      if (fs.existsSync(cacheFile)) {
        try {
          const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as DomainGenerationResult;
          if (cached.domainName && cached.domainSlug) {
            ctx.logger.info(`Resuming with cached domain result: "${cached.domainName}".`);
            if (ctx.options) {
              ctx.options._domainResult = cached;
            }
            return;
          }
        } catch {
          // Cache is corrupt; re-run analysis
        }
      }

      if (ctx.executor.dryRun) {
        ctx.logger.info(`[dry-run] Would analyze ${path.basename(repoPath)} and generate domain definition.`);
        return;
      }

      // 1. Scan the target repository
      ctx.logger.info(`Scanning repository at ${repoPath}...`);
      const repoCtx = scanRepository(repoPath);
      ctx.logger.info(
        `Detected: ${repoCtx.language}${repoCtx.framework ? ` / ${repoCtx.framework}` : ''}, ` +
          `${repoCtx.totalSourceFiles} source files.`,
      );

      // 2. Build prompt
      const prompt = buildDomainGenPrompt(repoCtx);

      // 3. Get AI client — honour --providers CLI flag, fall back to config
      const cliProvidersRaw = ctx.options?.providers as string | string[] | undefined;
      const cliProviders = typeof cliProvidersRaw === 'string'
        ? cliProvidersRaw.split(',').map((s: string) => s.trim()).filter(Boolean)
        : Array.isArray(cliProvidersRaw) ? cliProvidersRaw : [];
      const configuredProviders = getEnabledProviders(ctx.config);
      const providers = cliProviders.length > 0 ? cliProviders : configuredProviders;

      const client = createFirstAvailableClient(providers as ProviderKey[], ctx.config, ctx.logger);
      if (!client) {
        throw new CliError(
          'No AI provider available for domain analysis. ' +
            'Set OPENAI_API_KEY, configure claude CLI, install another supported provider, ' +
            'or pass --providers to select a specific provider.',
        );
      }

      // 4. Call AI
      const messages: AiMessage[] = [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ];

      const rawResponse = await withSpinner(
        'Generating domain definition via AI...',
        () => client.complete(messages, { maxTokens: 8192, temperature: 0.2 }),
        ctx.logger.verbosity === 'quiet',
      );

      // 5. Parse response
      const result = parseDomainGenerationResponse(rawResponse);
      ctx.logger.info(
        `Domain "${result.domainName}" generated: ` +
          `${result.principles.length} principles, ${result.rules.length} rules, ` +
          `${result.patterns.length} patterns, ${result.technologies.length} technologies.`,
      );

      // Store result for subsequent stages (in-memory + file for resume)
      if (ctx.options) {
        ctx.options._domainResult = result;
      }
      ctx.executor.writeFile(cacheFile, JSON.stringify(result, null, 2), {
        description: 'cache domain generation result for resume support',
      });
    },
  };
}

// ────────────────────────────────────────────────────────────────
// File-only stages
// ────────────────────────────────────────────────────────────────

/** Builds the stage that writes domain files to the local repository. */
function buildDomainFileWriteLocalStage(): OrchestrationStage {
  return {
    id: 'domain-file-write-local',
    title: 'Write domain files to local repo',
    recovery: [
      'Verify write permissions for the target repo directory.',
      'Run collab init repos <package> --resume to retry.',
    ],
    run: (ctx) => {
      const repoPath = ctx.options?._repoPath as string;
      const result = ctx.options?._domainResult as DomainGenerationResult | undefined;

      if (!result) {
        ctx.logger.info('No domain analysis result available; skipping file write.');
        return;
      }

      const targetDir = path.join(repoPath, 'docs', 'architecture', 'repo', 'domains', result.domainSlug);

      if (ctx.executor.dryRun) {
        ctx.logger.info(`[dry-run] Would write domain files to ${targetDir}`);
        return;
      }

      const count = writeDomainFiles(targetDir, result, ctx.executor);
      ctx.logger.info(`Domain files written: ${count} file(s) to ${targetDir}`);
    },
  };
}

// ────────────────────────────────────────────────────────────────
// Indexed stages
// ────────────────────────────────────────────────────────────────

/** Builds the stage that syncs the business canon repository before writing. */
function buildDomainCanonSyncStage(): OrchestrationStage {
  return {
    id: 'domain-canon-sync',
    title: 'Sync business canon repository',
    recovery: [
      'Ensure GitHub access is configured.',
      'Run collab init repos <package> --resume to retry.',
    ],
    run: (ctx) => {
      if (!isBusinessCanonConfigured(ctx.config)) {
        throw new CliError(
          'Business canon is not configured. Use --business-canon owner/repo to set it, or use --mode file-only.',
        );
      }

      if (ctx.executor.dryRun) {
        ctx.logger.info('[dry-run] Would sync business canon repository.');
        return;
      }

      const auth = loadGitHubAuth(ctx.config.collabDir);
      const token = auth?.token;
      const ok = syncBusinessCanon(ctx.config, (msg) => ctx.logger.info(msg), token);
      if (!ok) {
        throw new CliError('Failed to sync business canon repository.');
      }
    },
  };
}

/** Builds the stage that writes domain files to the business canon repository. */
function buildDomainFileWriteCanonStage(): OrchestrationStage {
  return {
    id: 'domain-file-write-canon',
    title: 'Write domain files to business canon',
    recovery: [
      'Verify write permissions for the business canon directory.',
      'Run collab init repos <package> --resume to retry.',
    ],
    run: (ctx) => {
      const result = ctx.options?._domainResult as DomainGenerationResult | undefined;

      if (!result) {
        ctx.logger.info('No domain analysis result available; skipping file write.');
        return;
      }

      const canonDir = getBusinessCanonDir(ctx.config);
      const targetDir = path.join(canonDir, 'domains', result.domainSlug);

      if (ctx.executor.dryRun) {
        ctx.logger.info(`[dry-run] Would write domain files to ${targetDir}`);
        return;
      }

      const count = writeDomainFiles(targetDir, result, ctx.executor);
      ctx.logger.info(`Domain files written: ${count} file(s) to ${targetDir}`);
    },
  };
}

/** Builds the stage that appends domain vertices and edges to the graph seed. */
function buildDomainGraphUpdateStage(): OrchestrationStage {
  return {
    id: 'domain-graph-update',
    title: 'Update graph seed with domain vertices',
    recovery: [
      'Verify write permissions for the business canon graph/seed directory.',
      'Run collab init repos <package> --resume to retry.',
    ],
    run: (ctx) => {
      const result = ctx.options?._domainResult as DomainGenerationResult | undefined;

      if (!result) {
        ctx.logger.info('No domain analysis result available; skipping graph update.');
        return;
      }

      const canonDir = getBusinessCanonDir(ctx.config);
      const dataPath = path.join(canonDir, 'graph', 'seed', 'data.ngql');

      if (ctx.executor.dryRun) {
        ctx.logger.info(`[dry-run] Would append graph seed data to ${dataPath}`);
        return;
      }

      const nextIds = findNextIds(dataPath);
      const nGql = generateDomainGraphSeed(result, nextIds);
      appendGraphSeed(dataPath, nGql, ctx.executor);

      const techCount = result.technologies.length;
      const patCount = result.patterns.length;
      ctx.logger.info(
        `Graph seed updated: 1 domain + ${techCount} technology + ${patCount} pattern vertices, ` +
          `${techCount + patCount} edges.`,
      );
    },
  };
}

/** Builds the stage that commits and pushes domain changes to the business canon. */
function buildDomainCanonPushStage(): OrchestrationStage {
  return {
    id: 'domain-canon-push',
    title: 'Commit and push domain to business canon',
    recovery: [
      'Ensure GitHub access is configured with push permissions.',
      'Run collab init repos <package> --resume to retry.',
    ],
    run: (ctx) => {
      const result = ctx.options?._domainResult as DomainGenerationResult | undefined;
      const repoPath = ctx.options?._repoPath as string;

      if (!result) {
        ctx.logger.info('No domain analysis result available; skipping push.');
        return;
      }

      const canonDir = getBusinessCanonDir(ctx.config);
      const repoName = repoPath ? path.basename(repoPath) : 'unknown';

      if (ctx.executor.dryRun) {
        ctx.logger.info(
          `[dry-run] Would commit and push domain "${result.domainName}" to business canon.`,
        );
        return;
      }

      // Stage files
      ctx.executor.run('git', ['-C', canonDir, 'add', `domains/${result.domainSlug}/`]);
      ctx.executor.run('git', ['-C', canonDir, 'add', 'graph/seed/data.ngql']);

      // Commit
      const commitMsg = `feat(domain): add ${result.domainName} from ${repoName}`;
      ctx.executor.run('git', ['-C', canonDir, 'commit', '-m', commitMsg]);

      // Push — use token auth via http.extraHeader to avoid leaking secrets in logs
      const auth = loadGitHubAuth(ctx.config.collabDir);
      if (auth?.token) {
        const canon = ctx.config.canons!.business!;
        const remoteUrl = `https://github.com/${canon.repo}.git`;
        const branch = canon.branch || 'main';
        ctx.executor.run('git', [
          '-C', canonDir,
          '-c', `http.${remoteUrl}.extraHeader=Authorization: Bearer ${auth.token}`,
          'push', remoteUrl, branch,
        ], { verboseOnly: true });
      } else {
        ctx.executor.run('git', ['-C', canonDir, 'push']);
      }

      ctx.logger.info(`Domain "${result.domainName}" committed and pushed to business canon.`);
    },
  };
}

/** Builds the stage that ingests domain files into MCP via HTTP. */
function buildDomainIngestStage(): OrchestrationStage {
  return {
    id: 'domain-ingest',
    title: 'Ingest domain files into MCP',
    recovery: [
      'Ensure MCP service is running and accessible.',
      'Run collab init repos <package> --resume to retry ingestion.',
    ],
    run: async (ctx) => {
      const result = ctx.options?._domainResult as DomainGenerationResult | undefined;

      if (!result) {
        ctx.logger.info('No domain analysis result available; skipping ingestion.');
        return;
      }

      if (ctx.executor.dryRun) {
        ctx.logger.info('[dry-run] Would ingest domain files into MCP via HTTP.');
        return;
      }

      const canonDir = getBusinessCanonDir(ctx.config);
      const domainDir = path.join(canonDir, 'domains', result.domainSlug);
      const baseUrl = getMcpBaseUrl(ctx.config);
      const env = loadRuntimeEnv(ctx.config);
      const apiKey = resolveMcpApiKey(env);
      const timeoutMs = resolveMcpHttpTimeoutMs(env);

      // Collect and ingest domain .md files
      const mdFiles = collectMarkdownFiles(domainDir);
      if (mdFiles.length > 0) {
        const configuredRepo = ctx.config.canons!.business!.repo;
        const repoSlug = configuredRepo.replace(/\.git$/, '').replace(/^https?:\/\/github\.com\//i, '');
        const scope = repoSlug.split('/').pop() ?? repoSlug;
        const org = repoSlug.includes('/') ? repoSlug.split('/')[0] : scope;

        const documents: IngestDocument[] = mdFiles.map((f) => ({
          path: path.relative(canonDir, f),
          content: fs.readFileSync(f, 'utf8'),
        }));

        ctx.logger.info(`Ingesting ${documents.length} domain file(s) via HTTP...`);

        const ingestResult = await ingestDocuments(
          baseUrl,
          {
            context: 'technical',
            scope,
            organization: org,
            repo: repoSlug.includes('/') ? repoSlug : `${org}/${repoSlug}`,
            documents,
          },
          apiKey,
          timeoutMs,
        );

        ctx.logger.info(
          `Domain ingested: ${ingestResult.vector.ingested_files} files, ` +
            `${ingestResult.vector.total_points} vectors, ` +
            `${ingestResult.graph.nodes_created} graph nodes.`,
        );
      }

      // Trigger graph re-seed
      ctx.logger.info('Triggering graph re-seed...');
      const seedResult = await triggerGraphSeed(baseUrl, apiKey, timeoutMs);
      ctx.logger.info(
        `Graph re-seed complete: ${seedResult.nodes_created} nodes, ${seedResult.edges_created} edges.`,
      );
    },
  };
}

// ────────────────────────────────────────────────────────────────
// Pipeline builders
// ────────────────────────────────────────────────────────────────

/**
 * Builds the file-only domain generation pipeline (2 stages).
 */
export function buildFileOnlyDomainPipeline(): OrchestrationStage[] {
  return [
    buildDomainAnalysisStage(),
    buildDomainFileWriteLocalStage(),
  ];
}

/**
 * Builds the indexed domain generation pipeline (6 stages).
 */
export function buildIndexedDomainPipeline(): OrchestrationStage[] {
  return [
    buildDomainCanonSyncStage(),
    buildDomainAnalysisStage(),
    buildDomainFileWriteCanonStage(),
    buildDomainGraphUpdateStage(),
    buildDomainCanonPushStage(),
    buildDomainIngestStage(),
  ];
}
