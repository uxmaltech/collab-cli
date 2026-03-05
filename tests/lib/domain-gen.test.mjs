import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { makeTempWorkspace } from '../helpers/workspace.mjs';

const {
  renderPrinciplesMd,
  renderRulesMd,
  renderAntiPatternsMd,
  renderGlossaryMd,
  renderPatternMd,
  writeDomainFiles,
  findNextIds,
  generateDomainGraphSeed,
  appendGraphSeed,
  buildDomainGenPrompt,
  parseDomainGenerationResponse,
} = await import('../../dist/lib/domain-gen.js');

// ── Test data ────────────────────────────────────────────────────

function makeSampleResult() {
  return {
    domainName: 'Chat AI',
    domainSlug: 'chat-ai',
    prefix: 'CHAT',
    summary: 'Conversational AI domain for chat functionality',
    principles: [
      { id: 'CHAT-P-001', text: 'Conversations are immutable once completed.' },
      { id: 'CHAT-P-002', text: 'AI responses must be deterministic given the same context.' },
    ],
    rules: [
      { id: 'CHAT-R-001', text: 'Message handlers MUST validate input before processing.' },
      { id: 'CHAT-R-002', text: 'AI providers MUST NOT store user data beyond the session.' },
    ],
    antiPatterns: [
      {
        id: 'CHAT-AP-001',
        description: 'Storing raw user messages without sanitization.',
        rulesViolated: ['CHAT-R-001'],
      },
    ],
    glossary: [
      { term: 'Conversation', definition: 'A sequence of messages between a user and an AI agent.' },
      { term: 'Context Window', definition: 'The set of messages visible to the AI at any point.' },
    ],
    patterns: [
      {
        id: 'CHAT-PAT-001',
        name: 'Message Pipeline',
        context: 'Processing incoming chat messages.',
        problem: 'Raw messages need validation, sanitization, and routing.',
        solution: 'Use a pipeline with discrete stages for each concern.',
        rulesEnforced: ['CHAT-R-001'],
        consequences: 'Clear separation of concerns at each pipeline stage.',
      },
    ],
    technologies: [
      { name: 'OpenAI', summary: 'Primary LLM provider for chat completion.' },
      { name: 'Redis', summary: 'Session store for active conversations.' },
    ],
  };
}

// ── Renderer tests ───────────────────────────────────────────────

test('renderPrinciplesMd produces correct format', () => {
  const result = makeSampleResult();
  const md = renderPrinciplesMd(result);

  assert.ok(md.startsWith('# Chat AI Principles\n'));
  assert.ok(md.includes('- CHAT-P-001: Conversations are immutable'));
  assert.ok(md.includes('- CHAT-P-002: AI responses must be deterministic'));
  assert.ok(md.includes('<!-- AI-GENERATED -->'));
});

test('renderRulesMd produces correct format', () => {
  const result = makeSampleResult();
  const md = renderRulesMd(result);

  assert.ok(md.startsWith('# Chat AI Rules\n'));
  assert.ok(md.includes('- CHAT-R-001: Message handlers MUST validate'));
  assert.ok(md.includes('- CHAT-R-002: AI providers MUST NOT store'));
  assert.ok(md.includes('<!-- AI-GENERATED -->'));
});

test('renderAntiPatternsMd includes rules violated', () => {
  const result = makeSampleResult();
  const md = renderAntiPatternsMd(result);

  assert.ok(md.startsWith('# Chat AI Anti-Patterns\n'));
  assert.ok(md.includes('- CHAT-AP-001: Storing raw user messages'));
  assert.ok(md.includes('**Rules Violated:**'));
  assert.ok(md.includes('  - CHAT-R-001'));
  assert.ok(md.includes('<!-- AI-GENERATED -->'));
});

test('renderGlossaryMd produces simple term list', () => {
  const result = makeSampleResult();
  const md = renderGlossaryMd(result);

  assert.ok(md.startsWith('# Chat AI Glossary\n'));
  assert.ok(md.includes('- Conversation: A sequence of messages'));
  assert.ok(md.includes('- Context Window: The set of messages'));
  assert.ok(md.includes('<!-- AI-GENERATED -->'));
});

test('renderPatternMd produces full pattern template', () => {
  const pattern = makeSampleResult().patterns[0];
  const md = renderPatternMd(pattern);

  assert.ok(md.startsWith('# Pattern: Message Pipeline\n'));
  assert.ok(md.includes('Pattern ID: CHAT-PAT-001'));
  assert.ok(md.includes('Status: Active'));
  assert.ok(md.includes('Context:\nProcessing incoming chat messages.'));
  assert.ok(md.includes('Problem:\nRaw messages need validation'));
  assert.ok(md.includes('Solution:\nUse a pipeline with discrete stages'));
  assert.ok(md.includes('Rules Enforced:\n- CHAT-R-001'));
  assert.ok(md.includes('Consequences:\nClear separation of concerns'));
  assert.ok(md.includes('<!-- AI-GENERATED -->'));
});

// ── writeDomainFiles test ────────────────────────────────────────

test('writeDomainFiles creates all expected files', () => {
  const workspace = makeTempWorkspace();
  const targetDir = path.join(workspace, 'domains', 'chat-ai');
  const result = makeSampleResult();

  const count = writeDomainFiles(targetDir, result);

  // 4 base files + 1 pattern = 5
  assert.equal(count, 5);
  assert.ok(fs.existsSync(path.join(targetDir, 'principles.md')));
  assert.ok(fs.existsSync(path.join(targetDir, 'rules.md')));
  assert.ok(fs.existsSync(path.join(targetDir, 'anti-patterns.md')));
  assert.ok(fs.existsSync(path.join(targetDir, 'glossary.md')));
  assert.ok(fs.existsSync(path.join(targetDir, 'patterns', 'message-pipeline.md')));

  // Verify content of a file
  const principlesContent = fs.readFileSync(path.join(targetDir, 'principles.md'), 'utf8');
  assert.ok(principlesContent.includes('# Chat AI Principles'));
});

test('writeDomainFiles with no patterns skips patterns dir', () => {
  const workspace = makeTempWorkspace();
  const targetDir = path.join(workspace, 'domains', 'simple');
  const result = { ...makeSampleResult(), patterns: [] };

  const count = writeDomainFiles(targetDir, result);

  assert.equal(count, 4);
  assert.ok(!fs.existsSync(path.join(targetDir, 'patterns')));
});

// ── Graph seed helpers tests ─────────────────────────────────────

test('findNextIds returns 1 for empty file', () => {
  const workspace = makeTempWorkspace();
  const dataPath = path.join(workspace, 'data.ngql');

  const ids = findNextIds(dataPath);
  assert.equal(ids.domain, 1);
  assert.equal(ids.pattern, 1);
  assert.equal(ids.technology, 1);
});

test('findNextIds detects existing IDs', () => {
  const workspace = makeTempWorkspace();
  const dataPath = path.join(workspace, 'data.ngql');

  fs.writeFileSync(
    dataPath,
    `INSERT VERTEX Node(name, type) VALUES "DOM-003":("Test", "domain");
INSERT VERTEX Node(name, type) VALUES "PAT-005":("Pattern", "pattern");
INSERT VERTEX Node(name, type) VALUES "TECH-002":("Tech", "technology");`,
  );

  const ids = findNextIds(dataPath);
  assert.equal(ids.domain, 4);
  assert.equal(ids.pattern, 6);
  assert.equal(ids.technology, 3);
});

test('generateDomainGraphSeed produces valid nGQL', () => {
  const result = makeSampleResult();
  const nextIds = { domain: 1, pattern: 1, technology: 1 };

  const nGql = generateDomainGraphSeed(result, nextIds);

  // Domain vertex
  assert.ok(nGql.includes('"DOM-001"'));
  assert.ok(nGql.includes('"Chat AI"'));
  assert.ok(nGql.includes('"domain"'));

  // Technology vertices
  assert.ok(nGql.includes('"TECH-001"'));
  assert.ok(nGql.includes('"OpenAI"'));
  assert.ok(nGql.includes('"TECH-002"'));
  assert.ok(nGql.includes('"Redis"'));

  // Pattern vertex
  assert.ok(nGql.includes('"PAT-001"'));
  assert.ok(nGql.includes('"Message Pipeline"'));

  // Edges
  assert.ok(nGql.includes('"USES_TECHNOLOGY"'));
  assert.ok(nGql.includes('"IMPLEMENTS"'));
});

test('appendGraphSeed creates file and appends', () => {
  const workspace = makeTempWorkspace();
  const dataPath = path.join(workspace, 'graph', 'seed', 'data.ngql');

  appendGraphSeed(dataPath, 'INSERT VERTEX Node(name) VALUES "TEST":("test");\n');

  assert.ok(fs.existsSync(dataPath));
  const content = fs.readFileSync(dataPath, 'utf8');
  assert.ok(content.includes('Domain generated by collab-cli'));
  assert.ok(content.includes('INSERT VERTEX'));
});

// ── AI prompt tests ──────────────────────────────────────────────

test('buildDomainGenPrompt includes repo context', () => {
  const repoCtx = {
    name: 'test-pkg',
    language: 'PHP',
    framework: 'Laravel',
    dependencies: ['laravel/framework', 'guzzlehttp/guzzle'],
    structure: 'app/\n  Models/\n  Http/',
    keyFiles: ['composer.json'],
    totalSourceFiles: 42,
  };

  const prompt = buildDomainGenPrompt(repoCtx);

  assert.ok(prompt.system.includes('software architecture analyst'));
  assert.ok(prompt.system.includes('domainName'));
  assert.ok(prompt.user.includes('test-pkg'));
  assert.ok(prompt.user.includes('PHP'));
  assert.ok(prompt.user.includes('Laravel'));
  assert.ok(prompt.user.includes('laravel/framework'));
  assert.ok(prompt.user.includes('42'));
});

// ── Response parser tests ────────────────────────────────────────

test('parseDomainGenerationResponse handles plain JSON', () => {
  const raw = JSON.stringify({
    domainName: 'Test',
    domainSlug: 'test',
    prefix: 'TST',
    summary: 'Test domain',
    principles: [{ id: 'TST-P-001', text: 'Be testable.' }],
    rules: [],
    antiPatterns: [],
    glossary: [],
    patterns: [],
    technologies: [],
  });

  const result = parseDomainGenerationResponse(raw);

  assert.equal(result.domainName, 'Test');
  assert.equal(result.domainSlug, 'test');
  assert.equal(result.prefix, 'TST');
  assert.equal(result.principles.length, 1);
});

test('parseDomainGenerationResponse handles code-fenced JSON', () => {
  const raw = 'Here is the result:\n```json\n' +
    JSON.stringify({
      domainName: 'Fenced',
      domainSlug: 'fenced',
      prefix: 'FNC',
      summary: 'Fenced domain',
    }) +
    '\n```\nDone.';

  const result = parseDomainGenerationResponse(raw);

  assert.equal(result.domainName, 'Fenced');
  assert.equal(result.prefix, 'FNC');
  assert.deepEqual(result.principles, []);
  assert.deepEqual(result.patterns, []);
});

test('parseDomainGenerationResponse throws on missing fields', () => {
  assert.throws(
    () => parseDomainGenerationResponse('{"foo": "bar"}'),
    { message: /Missing or invalid required field: domainName/ },
  );
});
