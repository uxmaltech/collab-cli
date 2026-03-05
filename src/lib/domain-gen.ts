import fs from 'node:fs';
import path from 'node:path';

import type { Executor } from './executor';
import type { RepoContext } from './repo-scanner';
import { extractJson } from './repo-analysis-helpers';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface DomainGenerationResult {
  domainName: string;
  domainSlug: string;
  prefix: string;
  summary: string;
  principles: { id: string; text: string }[];
  rules: { id: string; text: string }[];
  antiPatterns: { id: string; description: string; rulesViolated: string[] }[];
  glossary: { term: string; definition: string }[];
  patterns: DomainPattern[];
  technologies: { name: string; summary: string }[];
}

export interface DomainPattern {
  id: string;
  name: string;
  context: string;
  problem: string;
  solution: string;
  rulesEnforced: string[];
  consequences: string;
}

// ────────────────────────────────────────────────────────────────
// Renderers — follow exact collab-architecture/domains/ format
// ────────────────────────────────────────────────────────────────

/** Renders principles as markdown following the collab-architecture domain format. */
export function renderPrinciplesMd(r: DomainGenerationResult): string {
  const lines = [`# ${r.domainName} Principles`, ''];

  for (const p of r.principles) {
    lines.push(`- ${p.id}: ${p.text}`);
  }

  lines.push('');
  lines.push('<!-- AI-GENERATED -->');
  lines.push('');
  return lines.join('\n');
}

/** Renders rules as markdown following the collab-architecture domain format. */
export function renderRulesMd(r: DomainGenerationResult): string {
  const lines = [`# ${r.domainName} Rules`, ''];

  for (const rule of r.rules) {
    lines.push(`- ${rule.id}: ${rule.text}`);
  }

  lines.push('');
  lines.push('<!-- AI-GENERATED -->');
  lines.push('');
  return lines.join('\n');
}

/** Renders anti-patterns as markdown with violated rule references. */
export function renderAntiPatternsMd(r: DomainGenerationResult): string {
  const lines = [`# ${r.domainName} Anti-Patterns`, ''];

  for (const ap of r.antiPatterns) {
    lines.push(`- ${ap.id}: ${ap.description}`);
    lines.push('');
    lines.push('  **Rules Violated:**');
    for (const rule of ap.rulesViolated) {
      lines.push(`  - ${rule}`);
    }
    lines.push('');
  }

  lines.push('<!-- AI-GENERATED -->');
  lines.push('');
  return lines.join('\n');
}

/** Renders the domain glossary as a markdown term list. */
export function renderGlossaryMd(r: DomainGenerationResult): string {
  const lines = [`# ${r.domainName} Glossary`, ''];

  for (const g of r.glossary) {
    lines.push(`- ${g.term}: ${g.definition}`);
  }

  lines.push('');
  lines.push('<!-- AI-GENERATED -->');
  lines.push('');
  return lines.join('\n');
}

/** Renders a single pattern as a full markdown document with context, problem, and solution. */
export function renderPatternMd(p: DomainPattern): string {
  const lines = [
    `# Pattern: ${p.name}`,
    '',
    `Pattern ID: ${p.id}`,
    'Status: Active',
    'Confidence: provisional',
    '',
    'Context:',
    p.context,
    '',
    'Problem:',
    p.problem,
    '',
    'Solution:',
    p.solution,
    '',
    'Rules Enforced:',
    ...p.rulesEnforced.map((r) => `- ${r}`),
    '',
    'Consequences:',
    p.consequences,
    '',
    '<!-- AI-GENERATED -->',
    '',
  ];

  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────
// File writing
// ────────────────────────────────────────────────────────────────

/**
 * Sanitizes a string for use as a directory or file name.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Writes all domain files to a target directory via the executor abstraction.
 * Creates: principles.md, rules.md, anti-patterns.md, glossary.md, patterns/*.md
 *
 * When an executor is provided, all filesystem operations go through it
 * to respect `--dry-run` mode and centralized side-effect control.
 *
 * @returns The number of files written.
 */
export function writeDomainFiles(targetDir: string, result: DomainGenerationResult, executor?: Executor): number {
  let count = 0;

  const writeFile = (filePath: string, content: string, desc: string) => {
    if (executor) {
      executor.writeFile(filePath, content, { description: desc });
    } else {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf8');
    }
  };

  const ensureDir = (dirPath: string) => {
    if (executor) {
      executor.ensureDirectory(dirPath);
    } else {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  };

  ensureDir(targetDir);

  writeFile(path.join(targetDir, 'principles.md'), renderPrinciplesMd(result), 'write principles.md');
  count++;

  writeFile(path.join(targetDir, 'rules.md'), renderRulesMd(result), 'write rules.md');
  count++;

  writeFile(path.join(targetDir, 'anti-patterns.md'), renderAntiPatternsMd(result), 'write anti-patterns.md');
  count++;

  writeFile(path.join(targetDir, 'glossary.md'), renderGlossaryMd(result), 'write glossary.md');
  count++;

  if (result.patterns.length > 0) {
    const patternsDir = path.join(targetDir, 'patterns');
    ensureDir(patternsDir);

    for (const pattern of result.patterns) {
      const filename = `${slugify(pattern.name)}.md`;
      writeFile(path.join(patternsDir, filename), renderPatternMd(pattern), `write pattern ${filename}`);
      count++;
    }
  }

  return count;
}

// ────────────────────────────────────────────────────────────────
// Graph seed helpers (indexed path only)
// ────────────────────────────────────────────────────────────────

export interface NextIds {
  domain: number;
  pattern: number;
  technology: number;
}

/**
 * Parses an existing data.ngql file to find the next available IDs
 * for domains, patterns, and technologies.
 */
export function findNextIds(dataPath: string): NextIds {
  const ids: NextIds = { domain: 1, pattern: 1, technology: 1 };

  if (!fs.existsSync(dataPath)) {
    return ids;
  }

  const content = fs.readFileSync(dataPath, 'utf8');

  // Find highest DOM-NNN
  const domMatches = content.matchAll(/DOM-(\d+)/g);
  for (const m of domMatches) {
    const num = parseInt(m[1], 10);
    if (num >= ids.domain) ids.domain = num + 1;
  }

  // Find highest PAT-NNN
  const patMatches = content.matchAll(/PAT-(\d+)/g);
  for (const m of patMatches) {
    const num = parseInt(m[1], 10);
    if (num >= ids.pattern) ids.pattern = num + 1;
  }

  // Find highest TECH-NNN
  const techMatches = content.matchAll(/TECH-(\d+)/g);
  for (const m of techMatches) {
    const num = parseInt(m[1], 10);
    if (num >= ids.technology) ids.technology = num + 1;
  }

  return ids;
}

/**
 * Generates nGQL INSERT statements for a domain, its technologies,
 * patterns, and relationships.
 */
export function generateDomainGraphSeed(
  result: DomainGenerationResult,
  nextIds: NextIds,
): string {
  const lines: string[] = [];
  const pad = (n: number) => String(n).padStart(3, '0');

  const domId = `DOM-${pad(nextIds.domain)}`;

  // Domain vertex
  lines.push(
    `INSERT VERTEX Node(name, type, status, summary) VALUES` +
    ` "${domId}":("${escape(result.domainName)}", "domain", "active", "${escape(result.summary)}");`,
  );

  // Technology vertices and edges
  let techCounter = nextIds.technology;

  for (const tech of result.technologies) {
    const techId = `TECH-${pad(techCounter)}`;

    lines.push(
      `INSERT VERTEX Node(name, type, status, summary) VALUES` +
      ` "${techId}":("${escape(tech.name)}", "technology", "active", "${escape(tech.summary)}");`,
    );
    lines.push(
      `INSERT EDGE Relationship(type) VALUES` +
      ` "${domId}"->"${techId}":("USES_TECHNOLOGY");`,
    );
    techCounter++;
  }

  // Pattern vertices and edges
  let patCounter = nextIds.pattern;

  for (const pat of result.patterns) {
    const patId = `PAT-${pad(patCounter)}`;
    lines.push(
      `INSERT VERTEX Node(name, type, status, summary) VALUES` +
      ` "${patId}":("${escape(pat.name)}", "pattern", "active", "${escape(pat.context)}");`,
    );
    lines.push(
      `INSERT EDGE Relationship(type) VALUES` +
      ` "${domId}"->"${patId}":("IMPLEMENTS");`,
    );
    patCounter++;
  }

  lines.push('');
  return lines.join('\n');
}

function escape(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
}

/**
 * Appends nGQL statements to a data.ngql file, creating parent dirs if needed.
 *
 * When an executor is provided, the write goes through the executor abstraction
 * to respect `--dry-run` mode and centralized side-effect control.
 */
export function appendGraphSeed(dataPath: string, nGql: string, executor?: Executor): void {
  const separator = `\n-- Domain generated by collab-cli (${new Date().toISOString().split('T')[0]})\n`;
  const existing = fs.existsSync(dataPath) ? fs.readFileSync(dataPath, 'utf8') : '';

  if (executor) {
    executor.writeFile(dataPath, existing + separator + nGql, { description: 'append graph seed' });
  } else {
    fs.mkdirSync(path.dirname(dataPath), { recursive: true });
    fs.appendFileSync(dataPath, separator + nGql, 'utf8');
  }
}

// ────────────────────────────────────────────────────────────────
// AI prompt
// ────────────────────────────────────────────────────────────────

const DOMAIN_GEN_SYSTEM_PROMPT = `You are a software architecture analyst. Your task is to analyze a repository and generate canonical domain definitions following the collab-architecture framework format.

You MUST respond with a single JSON object — no markdown, no explanations, just JSON.

The JSON must follow this exact schema:

{
  "domainName": "Human-readable domain name (e.g. 'Chat AI', 'User Management')",
  "domainSlug": "kebab-case slug (e.g. 'chat-ai', 'user-management')",
  "prefix": "SHORT uppercase prefix for IDs (e.g. 'CHAT', 'USR') — max 4 characters",
  "summary": "One-sentence summary of this domain's purpose",
  "principles": [
    { "id": "{PREFIX}-P-001", "text": "Concise principle statement" }
  ],
  "rules": [
    { "id": "{PREFIX}-R-001", "text": "Prescriptive rule using MUST/MUST NOT language" }
  ],
  "antiPatterns": [
    {
      "id": "{PREFIX}-AP-001",
      "description": "Description of the anti-pattern",
      "rulesViolated": ["{PREFIX}-R-001"]
    }
  ],
  "glossary": [
    { "term": "Term", "definition": "Clear one-line definition" }
  ],
  "patterns": [
    {
      "id": "{PREFIX}-PAT-001",
      "name": "Pattern Name",
      "context": "When/where this pattern applies",
      "problem": "What problem it solves",
      "solution": "How to implement it",
      "rulesEnforced": ["{PREFIX}-R-001"],
      "consequences": "What happens when you follow this pattern"
    }
  ],
  "technologies": [
    { "name": "Technology Name", "summary": "Brief description of role in domain" }
  ]
}

Guidelines:
- Generate 3-7 principles, 3-7 rules, 2-5 anti-patterns, 5-10 glossary terms, 2-5 patterns, and list all key technologies
- Principles are aspirational statements of what should be true
- Rules are prescriptive and use MUST/MUST NOT language
- Anti-patterns reference specific rule IDs they violate
- Patterns reference specific rule IDs they enforce
- Technologies should list frameworks, databases, message brokers, etc. used by the domain`;

/**
 * Builds the AI prompt messages for domain generation.
 */
export function buildDomainGenPrompt(repoCtx: RepoContext): { system: string; user: string } {
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
    'Analyze this repository and generate a complete domain definition as a JSON object.',
  ];

  return {
    system: DOMAIN_GEN_SYSTEM_PROMPT,
    user: parts.filter((p) => p !== null).join('\n'),
  };
}

// ────────────────────────────────────────────────────────────────
// Response parser
// ────────────────────────────────────────────────────────────────

/**
 * Parses the AI response into a DomainGenerationResult.
 * Handles JSON wrapped in markdown code fences.
 * Validates required fields and nested element shapes, failing fast on malformed data.
 */
export function parseDomainGenerationResponse(raw: string): DomainGenerationResult {
  const jsonStr = extractJson(raw);
  const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

  // Validate required fields
  const required = ['domainName', 'domainSlug', 'prefix', 'summary'];
  for (const field of required) {
    if (!parsed[field] || typeof parsed[field] !== 'string') {
      throw new Error(`Missing or invalid required field: ${field}`);
    }
  }

  return {
    domainName: parsed.domainName as string,
    domainSlug: parsed.domainSlug as string,
    prefix: parsed.prefix as string,
    summary: parsed.summary as string,
    principles: validateArray(parsed.principles, 'principles', ['id', 'text']),
    rules: validateArray(parsed.rules, 'rules', ['id', 'text']),
    antiPatterns: validateArray(parsed.antiPatterns, 'antiPatterns', ['id', 'description']),
    glossary: validateArray(parsed.glossary, 'glossary', ['term', 'definition']),
    patterns: validateArray(parsed.patterns, 'patterns', ['id', 'name']),
    technologies: validateArray(parsed.technologies, 'technologies', ['name', 'summary']),
  };
}

/**
 * Validates an array field from the AI response, filtering out malformed entries
 * and ensuring each element has the required string fields.
 */
function validateArray<T>(value: unknown, fieldName: string, requiredKeys: string[]): T[] {
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is T => {
    if (typeof item !== 'object' || item === null) return false;
    const obj = item as Record<string, unknown>;
    return requiredKeys.every((key) => typeof obj[key] === 'string' && obj[key] !== '');
  });
}
