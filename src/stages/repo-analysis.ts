import fs from 'node:fs';
import path from 'node:path';

import { createFirstAvailableClient, type AiMessage } from '../lib/ai-client';
import type { OrchestrationStage, StageContext } from '../lib/orchestrator';
import { getEnabledProviders } from '../lib/providers';
import { scanRepository, type RepoContext } from '../lib/repo-scanner';
import { systemPromptTemplate } from '../templates/canon/system-prompt';

const PLACEHOLDER_MARKER = '<!-- AI-GENERATED: PLACEHOLDER -->';

interface AnalysisResult {
  axioms?: AnalysisEntry[];
  decisions?: AnalysisEntry[];
  conventions?: AnalysisEntry[];
  antiPatterns?: AnalysisEntry[];
  domains?: DomainEntry[];
}

interface AnalysisEntry {
  id: string;
  title: string;
  confidence?: string;
  [key: string]: unknown;
}

interface DomainEntry {
  name: string;
  confidence?: string;
  responsibilities?: string;
  boundaries?: string;
  dependencies?: string;
  publicApi?: string;
}

/**
 * Builds the user message with the repository context.
 */
function buildUserMessage(repoCtx: RepoContext): string {
  const parts = [
    `# Repository: ${repoCtx.name}`,
    '',
    `**Language:** ${repoCtx.language}`,
    repoCtx.framework ? `**Framework:** ${repoCtx.framework}` : null,
    `**Source files:** ${repoCtx.totalSourceFiles}`,
    '',
    '## Dependencies',
    repoCtx.dependencies.length > 0
      ? repoCtx.dependencies.map((d) => `- ${d}`).join('\n')
      : '_No dependencies detected._',
    '',
    '## Key Files',
    repoCtx.keyFiles.map((f) => `- ${f}`).join('\n'),
    '',
    '## Directory Structure',
    '```',
    repoCtx.structure,
    '```',
    '',
    'Analyze this repository and generate the canonical architecture documentation.',
  ];

  return parts.filter((p) => p !== null).join('\n');
}

/**
 * Checks if a file can be overwritten by the AI analysis.
 * Only files containing the PLACEHOLDER_MARKER are overwritten.
 */
function canOverwrite(filePath: string): boolean {
  if (!fs.existsSync(filePath)) {
    return true;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  return content.includes(PLACEHOLDER_MARKER);
}

/**
 * Renders an axiom entry to Markdown.
 */
function renderAxiom(entry: AnalysisEntry): string {
  return [
    `# ${entry.id}: ${entry.title}`,
    '',
    `**Confidence:** ${entry.confidence ?? 'MEDIUM'}`,
    `**Verified:** ${new Date().toISOString().split('T')[0]}`,
    '',
    '## Statement',
    '',
    String(entry.statement ?? entry.title),
    '',
    '## Rationale',
    '',
    String(entry.rationale ?? '_Not provided._'),
    '',
    '## Verification',
    '',
    String(entry.verification ?? '_Pending verification._'),
    '',
    '<!-- AI-GENERATED -->',
    '',
  ].join('\n');
}

/**
 * Renders a decision (ADR) entry to Markdown.
 */
function renderDecision(entry: AnalysisEntry): string {
  return [
    `# ${entry.id}: ${entry.title}`,
    '',
    `**Status:** ${entry.status ?? 'Accepted'}`,
    `**Date:** ${new Date().toISOString().split('T')[0]}`,
    `**Confidence:** ${entry.confidence ?? 'MEDIUM'}`,
    '',
    '## Context',
    '',
    String(entry.context ?? '_Not provided._'),
    '',
    '## Decision',
    '',
    String(entry.decision ?? '_Not provided._'),
    '',
    '## Consequences',
    '',
    String(entry.consequences ?? '_Not provided._'),
    '',
    '<!-- AI-GENERATED -->',
    '',
  ].join('\n');
}

/**
 * Renders a convention entry to Markdown.
 */
function renderConvention(entry: AnalysisEntry): string {
  return [
    `# ${entry.id}: ${entry.title}`,
    '',
    `**Confidence:** ${entry.confidence ?? 'MEDIUM'}`,
    `**Scope:** ${entry.scope ?? 'project'}`,
    '',
    '## Convention',
    '',
    String(entry.convention ?? entry.title),
    '',
    '## Examples',
    '',
    String(entry.examples ?? '_See codebase._'),
    '',
    '## Rationale',
    '',
    String(entry.rationale ?? '_Not provided._'),
    '',
    '<!-- AI-GENERATED -->',
    '',
  ].join('\n');
}

/**
 * Renders an anti-pattern entry to Markdown.
 */
function renderAntiPattern(entry: AnalysisEntry): string {
  return [
    `# ${entry.id}: ${entry.title}`,
    '',
    `**Confidence:** ${entry.confidence ?? 'MEDIUM'}`,
    `**Severity:** ${entry.severity ?? 'warning'}`,
    '',
    '## Problem',
    '',
    String(entry.problem ?? entry.title),
    '',
    '## Why It\'s Harmful',
    '',
    String(entry.harm ?? '_Not provided._'),
    '',
    '## Alternative',
    '',
    String(entry.alternative ?? '_Not provided._'),
    '',
    '<!-- AI-GENERATED -->',
    '',
  ].join('\n');
}

/**
 * Renders a domain entry to Markdown.
 */
function renderDomain(entry: DomainEntry): string {
  return [
    `# Domain: ${entry.name}`,
    '',
    `**Confidence:** ${entry.confidence ?? 'MEDIUM'}`,
    '',
    '## Responsibilities',
    '',
    String(entry.responsibilities ?? '_Not provided._'),
    '',
    '## Boundaries',
    '',
    String(entry.boundaries ?? '_Not provided._'),
    '',
    '## Dependencies',
    '',
    String(entry.dependencies ?? '_None._'),
    '',
    '## Public API',
    '',
    String(entry.publicApi ?? '_Not defined._'),
    '',
    '<!-- AI-GENERATED -->',
    '',
  ].join('\n');
}

/**
 * Extracts JSON from a response that may contain markdown code fences.
 */
function extractJson(text: string): string {
  // Try to extract from code fence
  const fenceMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  // Try raw JSON
  const braceStart = text.indexOf('{');
  const braceEnd = text.lastIndexOf('}');
  if (braceStart >= 0 && braceEnd > braceStart) {
    return text.slice(braceStart, braceEnd + 1);
  }

  return text;
}

/**
 * Sanitizes an ID for use as a filename (e.g., "AX-001" → "AX-001").
 */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9-]/g, '-');
}

/**
 * Writes analysis results to the architecture directory.
 */
function writeAnalysisResults(ctx: StageContext, result: AnalysisResult): void {
  const archDir = ctx.config.architectureDir;
  let written = 0;

  // Axioms
  if (result.axioms) {
    for (const entry of result.axioms) {
      const filename = `${sanitizeId(entry.id)}-${sanitizeId(entry.title).toLowerCase().slice(0, 40)}.md`;
      const filePath = path.join(archDir, 'knowledge', 'axioms', filename);
      if (canOverwrite(filePath)) {
        ctx.executor.ensureDirectory(path.dirname(filePath));
        ctx.executor.writeFile(filePath, renderAxiom(entry), { description: `write axiom ${entry.id}` });
        written++;
      }
    }
  }

  // Decisions
  if (result.decisions) {
    for (const entry of result.decisions) {
      const filename = `${sanitizeId(entry.id)}-${sanitizeId(entry.title).toLowerCase().slice(0, 40)}.md`;
      const filePath = path.join(archDir, 'knowledge', 'decisions', filename);
      if (canOverwrite(filePath)) {
        ctx.executor.ensureDirectory(path.dirname(filePath));
        ctx.executor.writeFile(filePath, renderDecision(entry), { description: `write decision ${entry.id}` });
        written++;
      }
    }
  }

  // Conventions
  if (result.conventions) {
    for (const entry of result.conventions) {
      const filename = `${sanitizeId(entry.id)}-${sanitizeId(entry.title).toLowerCase().slice(0, 40)}.md`;
      const filePath = path.join(archDir, 'knowledge', 'conventions', filename);
      if (canOverwrite(filePath)) {
        ctx.executor.ensureDirectory(path.dirname(filePath));
        ctx.executor.writeFile(filePath, renderConvention(entry), { description: `write convention ${entry.id}` });
        written++;
      }
    }
  }

  // Anti-patterns
  if (result.antiPatterns) {
    for (const entry of result.antiPatterns) {
      const filename = `${sanitizeId(entry.id)}-${sanitizeId(entry.title).toLowerCase().slice(0, 40)}.md`;
      const filePath = path.join(archDir, 'knowledge', 'anti-patterns', filename);
      if (canOverwrite(filePath)) {
        ctx.executor.ensureDirectory(path.dirname(filePath));
        ctx.executor.writeFile(filePath, renderAntiPattern(entry), { description: `write anti-pattern ${entry.id}` });
        written++;
      }
    }
  }

  // Domains
  if (result.domains) {
    for (const entry of result.domains) {
      const safeName = sanitizeId(entry.name).toLowerCase();
      const filename = `${safeName}.md`;
      const filePath = path.join(archDir, 'domains', filename);
      if (canOverwrite(filePath)) {
        ctx.executor.ensureDirectory(path.dirname(filePath));
        ctx.executor.writeFile(filePath, renderDomain(entry), { description: `write domain ${entry.name}` });
        written++;
      }
    }
  }

  ctx.logger.info(`Repository analysis: ${written} architecture file(s) written.`);
}

export const repoAnalysisStage: OrchestrationStage = {
  id: 'repo-analysis',
  title: 'AI-powered repository analysis',
  recovery: [
    'Ensure AI provider API keys are set in environment.',
    'Run collab init --resume to retry repository analysis.',
  ],
  run: async (ctx) => {
    if (ctx.options?.skipAnalysis) {
      ctx.logger.info('Skipping repository analysis by user choice.');
      return;
    }

    const enabledProviders = getEnabledProviders(ctx.config);
    if (enabledProviders.length === 0) {
      ctx.logger.info('No providers enabled; skipping repository analysis.');
      return;
    }

    // In dry-run mode, just show what would happen
    if (ctx.executor.dryRun) {
      ctx.logger.info('[dry-run] Would analyze repository and generate architecture files.');
      return;
    }

    const client = await createFirstAvailableClient(enabledProviders, ctx.config, ctx.logger);
    if (!client) {
      ctx.logger.warn('No AI provider credentials available; skipping repository analysis.');
      return;
    }

    ctx.logger.info('Scanning repository structure...');
    const repoCtx = scanRepository(ctx.config.workspaceDir);

    ctx.logger.info(
      `Repository: ${repoCtx.name} (${repoCtx.language}${repoCtx.framework ? ` / ${repoCtx.framework}` : ''}, ${repoCtx.totalSourceFiles} source files)`,
    );

    const messages: AiMessage[] = [
      { role: 'system', content: systemPromptTemplate },
      { role: 'user', content: buildUserMessage(repoCtx) },
    ];

    ctx.logger.info('Analyzing repository with AI provider...');
    const response = await client.complete(messages, { maxTokens: 8192 });

    // Parse the response
    let analysis: AnalysisResult;
    try {
      const jsonStr = extractJson(response);
      analysis = JSON.parse(jsonStr);
    } catch (err) {
      ctx.logger.warn(`Failed to parse AI analysis response: ${err}`);
      ctx.logger.debug(`Raw response (first 500 chars): ${response.slice(0, 500)}`);
      return;
    }

    writeAnalysisResults(ctx, analysis);
  },
};
