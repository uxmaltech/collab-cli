import { readFileSync } from 'node:fs';
import path from 'node:path';

// web-tree-sitter is an ESM-primary package but also exports CJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TreeSitter = require('web-tree-sitter') as typeof import('web-tree-sitter');
const { Parser, Language, Query } = TreeSitter;

type TSLanguage = InstanceType<typeof Language>;

const QUERIES_DIR = path.resolve(__dirname, '../../../queries');

let _initialized = false;

async function ensureInit(): Promise<void> {
  if (_initialized) return;
  await Parser.init();
  _initialized = true;
}

const _languages: Record<string, TSLanguage> = {};

async function loadLanguage(language: string): Promise<TSLanguage> {
  if (_languages[language]) return _languages[language];

  let wasmPath: string;
  if (language === 'php') {
    wasmPath = require.resolve('tree-sitter-php/tree-sitter-php.wasm');
  } else if (language === 'typescript' || language === 'javascript') {
    wasmPath = require.resolve('tree-sitter-typescript/tree-sitter-typescript.wasm');
  } else {
    throw new Error(`Unsupported language for tree-sitter: ${language}`);
  }

  const lang = await Language.load(wasmPath);
  _languages[language] = lang;
  return lang;
}

export interface QueryMatch {
  patternIndex: number;
  captures: Array<{ name: string; node: SyntaxNode }>;
}

export interface SyntaxNode {
  startIndex: number;
  endIndex: number;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
}

/**
 * Snapshot a WASM tree-sitter node into a plain JS object.
 * WASM nodes become invalid after the tree is deleted, so we must
 * extract all needed properties while the tree is still alive.
 */
function snapshotNode(node: import('web-tree-sitter').Node): SyntaxNode {
  return {
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    startPosition: { row: node.startPosition.row, column: node.startPosition.column },
    endPosition: { row: node.endPosition.row, column: node.endPosition.column },
  };
}

/**
 * Parse source text and run a .scm query file against it.
 * Returns matches with snapshotted node data (safe to use after tree deletion).
 */
export async function runQuery(opts: {
  language: string;
  sourceText: string;
  queryFile: string;
}): Promise<QueryMatch[]> {
  await ensureInit();

  const lang = await loadLanguage(opts.language);

  const parser = new Parser();
  parser.setLanguage(lang);

  const tree = parser.parse(opts.sourceText);
  if (!tree) {
    throw new Error(`tree-sitter failed to parse source (language=${opts.language})`);
  }

  const normalizedLang = opts.language === 'javascript' ? 'typescript' : opts.language;
  const queryPath = path.join(QUERIES_DIR, normalizedLang, opts.queryFile);
  const querySource = readFileSync(queryPath, 'utf8');

  const query = new Query(lang, querySource);
  const rawMatches = query.matches(tree.rootNode);

  // Snapshot all node data before cleaning up WASM resources
  const results: QueryMatch[] = rawMatches.map((m) => ({
    patternIndex: m.patternIndex,
    captures: m.captures.map((c) => ({
      name: c.name,
      node: snapshotNode(c.node),
    })),
  }));

  // Clean up WASM resources
  query.delete();
  tree.delete();
  parser.delete();

  return results;
}

/**
 * Get the source text slice for a tree-sitter node.
 */
export function nodeText(
  node: { startIndex: number; endIndex: number },
  sourceText: string,
): string {
  return sourceText.slice(node.startIndex, node.endIndex);
}

/**
 * Get start/end line numbers (1-based) for a tree-sitter node.
 */
export function nodeLines(node: {
  startPosition: { row: number };
  endPosition: { row: number };
}): { startLine: number; endLine: number } {
  return {
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
  };
}
