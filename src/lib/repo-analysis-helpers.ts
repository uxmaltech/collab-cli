import fs from 'node:fs';
import path from 'node:path';

import type { StageContext } from './orchestrator';
import type { RepoContext } from './repo-scanner';

export const PLACEHOLDER_MARKER = '<!-- AI-GENERATED: PLACEHOLDER -->';

export interface AnalysisResult {
  axioms?: AnalysisEntry[];
  decisions?: AnalysisEntry[];
  conventions?: AnalysisEntry[];
  antiPatterns?: AnalysisEntry[];
  domains?: DomainEntry[];
}

export interface AnalysisEntry {
  id: string;
  title: string;
  confidence?: string;
  [key: string]: unknown;
}

export interface DomainEntry {
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
export function buildUserMessage(repoCtx: RepoContext): string {
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
export function canOverwrite(filePath: string): boolean {
  if (!fs.existsSync(filePath)) {
    return true;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  return content.includes(PLACEHOLDER_MARKER);
}

/**
 * Extracts JSON from a response that may contain markdown code fences.
 */
export function extractJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  const braceStart = text.indexOf('{');
  const braceEnd = text.lastIndexOf('}');
  if (braceStart >= 0 && braceEnd > braceStart) {
    return text.slice(braceStart, braceEnd + 1);
  }

  return text;
}

/**
 * Sanitizes an ID for use as a filename.
 */
export function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9-]/g, '-');
}

export function renderAxiom(entry: AnalysisEntry): string {
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

export function renderDecision(entry: AnalysisEntry): string {
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

export function renderConvention(entry: AnalysisEntry): string {
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

export function renderAntiPattern(entry: AnalysisEntry): string {
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

export function renderDomain(entry: DomainEntry): string {
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
 * Writes analysis results to a base directory.
 * Used by both indexed (architectureDir) and file-only (repoDir) stages.
 */
export function writeAnalysisResults(ctx: StageContext, baseDir: string, result: AnalysisResult): void {
  let written = 0;

  if (result.axioms) {
    for (const entry of result.axioms) {
      const filename = `${sanitizeId(entry.id)}-${sanitizeId(entry.title).toLowerCase().slice(0, 40)}.md`;
      const filePath = path.join(baseDir, 'knowledge', 'axioms', filename);
      if (canOverwrite(filePath)) {
        ctx.executor.ensureDirectory(path.dirname(filePath));
        ctx.executor.writeFile(filePath, renderAxiom(entry), { description: `write axiom ${entry.id}` });
        written++;
      }
    }
  }

  if (result.decisions) {
    for (const entry of result.decisions) {
      const filename = `${sanitizeId(entry.id)}-${sanitizeId(entry.title).toLowerCase().slice(0, 40)}.md`;
      const filePath = path.join(baseDir, 'knowledge', 'decisions', filename);
      if (canOverwrite(filePath)) {
        ctx.executor.ensureDirectory(path.dirname(filePath));
        ctx.executor.writeFile(filePath, renderDecision(entry), { description: `write decision ${entry.id}` });
        written++;
      }
    }
  }

  if (result.conventions) {
    for (const entry of result.conventions) {
      const filename = `${sanitizeId(entry.id)}-${sanitizeId(entry.title).toLowerCase().slice(0, 40)}.md`;
      const filePath = path.join(baseDir, 'knowledge', 'conventions', filename);
      if (canOverwrite(filePath)) {
        ctx.executor.ensureDirectory(path.dirname(filePath));
        ctx.executor.writeFile(filePath, renderConvention(entry), { description: `write convention ${entry.id}` });
        written++;
      }
    }
  }

  if (result.antiPatterns) {
    for (const entry of result.antiPatterns) {
      const filename = `${sanitizeId(entry.id)}-${sanitizeId(entry.title).toLowerCase().slice(0, 40)}.md`;
      const filePath = path.join(baseDir, 'knowledge', 'anti-patterns', filename);
      if (canOverwrite(filePath)) {
        ctx.executor.ensureDirectory(path.dirname(filePath));
        ctx.executor.writeFile(filePath, renderAntiPattern(entry), { description: `write anti-pattern ${entry.id}` });
        written++;
      }
    }
  }

  if (result.domains) {
    for (const entry of result.domains) {
      const safeName = sanitizeId(entry.name).toLowerCase();
      const filename = `${safeName}.md`;
      const filePath = path.join(baseDir, 'domains', filename);
      if (canOverwrite(filePath)) {
        ctx.executor.ensureDirectory(path.dirname(filePath));
        ctx.executor.writeFile(filePath, renderDomain(entry), { description: `write domain ${entry.name}` });
        written++;
      }
    }
  }

  ctx.logger.info(`Repository analysis: ${written} architecture file(s) written.`);
}
