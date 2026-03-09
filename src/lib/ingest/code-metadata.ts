import type { SymbolInfo } from './types';

const CODE_LANGUAGES = new Set([
  'php',
  'typescript',
  'javascript',
  'python',
  'go',
  'java',
  'kotlin',
  'ruby',
  'sql',
  'bash',
  'shell',
]);

const DOC_LANGUAGES = new Set(['markdown', 'mdx', 'rst', 'text']);

function extensionFromPath(sourcePath: string): string {
  const baseName = String(sourcePath || '').split('/').pop() || '';
  const lowerBase = baseName.toLowerCase();

  if (lowerBase.startsWith('dockerfile')) return 'dockerfile';

  const dot = lowerBase.lastIndexOf('.');
  if (dot < 0) return '';
  return lowerBase.slice(dot + 1);
}

export function detectLanguage(sourcePath: string): string {
  const ext = extensionFromPath(sourcePath);
  const lowerPath = String(sourcePath || '').toLowerCase();

  switch (ext) {
    case 'php':
      return 'php';
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'md':
      return 'markdown';
    case 'mdx':
      return 'mdx';
    case 'rst':
      return 'rst';
    case 'txt':
      return 'text';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'json':
      return 'json';
    case 'py':
      return 'python';
    case 'go':
      return 'go';
    case 'java':
      return 'java';
    case 'kt':
      return 'kotlin';
    case 'rb':
      return 'ruby';
    case 'sql':
      return 'sql';
    case 'sh':
      return 'shell';
    case 'bash':
      return 'bash';
    case 'dockerfile':
      return 'dockerfile';
    default:
      if (lowerPath.endsWith('/dockerfile')) return 'dockerfile';
      return ext || 'unknown';
  }
}

function hasTestPattern(lowerPath: string): boolean {
  return (
    /(^|\/)(__tests__|tests?|specs?)(\/|$)/.test(lowerPath) ||
    /\.(test|spec)\.[a-z0-9]+$/.test(lowerPath)
  );
}

function hasConfigPattern(lowerPath: string, baseName: string): boolean {
  if (
    /(^|\/)(config)(\/|$)/.test(lowerPath) ||
    /(\.config\.(js|ts|mjs|cjs|json|yml|yaml))$/.test(lowerPath)
  ) {
    return true;
  }

  return new Set([
    'package.json',
    'composer.json',
    'tsconfig.json',
    'jsconfig.json',
    'vite.config.js',
    'vite.config.ts',
    'webpack.config.js',
    'webpack.config.ts',
    'docker-compose.yml',
    'docker-compose.yaml',
    '.env',
    '.env.example',
  ]).has(baseName);
}

export function classifyContentKind(opts: {
  sourcePath: string;
  language: string;
  symbols?: SymbolInfo[];
}): string {
  const { sourcePath, language, symbols } = opts;
  const lowerPath = String(sourcePath || '').toLowerCase();
  const baseName = lowerPath.split('/').pop() || '';

  if (DOC_LANGUAGES.has(language)) {
    if (baseName.startsWith('readme')) return 'docs.readme';
    if (/(architecture|adr|decision|rfc|design)/.test(lowerPath)) return 'docs.architecture';
    return 'docs.guide';
  }

  if (hasTestPattern(lowerPath)) return 'code.test';
  if (hasConfigPattern(lowerPath, baseName)) return 'code.config';

  const hasClass = (symbols || []).some((s) => s.kind === 'class');
  const hasFunction = (symbols || []).some((s) => s.kind === 'function' || s.kind === 'method');

  if (hasClass) return 'code.class';
  if (hasFunction) return 'code.function';
  if (CODE_LANGUAGES.has(language)) return 'code.module';

  return 'unknown';
}

function inferSymbolLine(match: RegExpExecArray, sourceText: string): number {
  const snippet = String(sourceText || '').slice(0, match.index || 0);
  return snippet.split('\n').length;
}

export function heuristicallyExtractSymbols(opts: {
  language: string;
  sourceText: string;
}): SymbolInfo[] {
  const symbols: SymbolInfo[] = [];
  const { language } = opts;
  const text = String(opts.sourceText || '');

  if (language === 'php') {
    const namespaceMatch = text.match(/\bnamespace\s+([^;\n]+)\s*;/m);
    const namespace = namespaceMatch?.[1]?.trim() || null;

    const classRegex =
      /\b(?:final\s+|abstract\s+)?(?:class|interface|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
    let classMatch: RegExpExecArray | null;
    while ((classMatch = classRegex.exec(text)) !== null) {
      const className = classMatch[1];
      const classPath = namespace ? `${namespace}\\${className}` : className;
      symbols.push({
        kind: 'class',
        name: className,
        path: classPath,
        startLine: inferSymbolLine(classMatch, text),
        endLine: null,
      });
    }

    const functionRegex = /\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    let fnMatch: RegExpExecArray | null;
    while ((fnMatch = functionRegex.exec(text)) !== null) {
      const fnName = fnMatch[1];
      const fnPath = namespace ? `${namespace}\\${fnName}` : fnName;
      symbols.push({
        kind: 'function',
        name: fnName,
        path: fnPath,
        startLine: inferSymbolLine(fnMatch, text),
        endLine: null,
      });
    }

    return symbols;
  }

  if (language === 'typescript' || language === 'javascript') {
    const classRegex = /\bclass\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
    let classMatch: RegExpExecArray | null;
    while ((classMatch = classRegex.exec(text)) !== null) {
      symbols.push({
        kind: 'class',
        name: classMatch[1],
        path: classMatch[1],
        startLine: inferSymbolLine(classMatch, text),
        endLine: null,
      });
    }

    const fnRegex = /\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
    let fnMatch: RegExpExecArray | null;
    while ((fnMatch = fnRegex.exec(text)) !== null) {
      symbols.push({
        kind: 'function',
        name: fnMatch[1],
        path: fnMatch[1],
        startLine: inferSymbolLine(fnMatch, text),
        endLine: null,
      });
    }

    const arrowRegex =
      /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>/g;
    let arrowMatch: RegExpExecArray | null;
    while ((arrowMatch = arrowRegex.exec(text)) !== null) {
      symbols.push({
        kind: 'function',
        name: arrowMatch[1],
        path: arrowMatch[1],
        startLine: inferSymbolLine(arrowMatch, text),
        endLine: null,
      });
    }

    return symbols;
  }

  return [];
}

function overlapSize(opts: {
  chunkStart: number;
  chunkEnd: number;
  symbolStart: number | null;
  symbolEnd: number | null;
}): number {
  if (!Number.isInteger(opts.chunkStart) || !Number.isInteger(opts.chunkEnd)) return 0;
  if (!Number.isInteger(opts.symbolStart)) return 0;

  const effectiveSymbolEnd = Number.isInteger(opts.symbolEnd)
    ? (opts.symbolEnd as number)
    : (opts.symbolStart as number);
  const start = Math.max(opts.chunkStart, opts.symbolStart as number);
  const end = Math.min(opts.chunkEnd, effectiveSymbolEnd);
  if (end < start) return 0;
  return end - start + 1;
}

function symbolPriority(kind: string): number {
  if (kind === 'method') return 3;
  if (kind === 'function') return 2;
  if (kind === 'class') return 1;
  return 0;
}

export function selectChunkSymbol(opts: {
  symbols: SymbolInfo[];
  chunkStartLine: number;
  chunkEndLine: number;
}): SymbolInfo | null {
  const { symbols, chunkStartLine, chunkEndLine } = opts;
  if (!Array.isArray(symbols) || !symbols.length) return null;

  const candidates = symbols
    .map((symbol) => ({
      symbol,
      overlap: overlapSize({
        chunkStart: chunkStartLine,
        chunkEnd: chunkEndLine,
        symbolStart: symbol.startLine,
        symbolEnd: symbol.endLine,
      }),
    }))
    .filter((entry) => entry.overlap > 0);

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    if (b.overlap !== a.overlap) return b.overlap - a.overlap;
    const priorityDelta = symbolPriority(b.symbol.kind) - symbolPriority(a.symbol.kind);
    if (priorityDelta !== 0) return priorityDelta;
    const aStart = Number.isInteger(a.symbol.startLine)
      ? (a.symbol.startLine as number)
      : Number.MAX_SAFE_INTEGER;
    const bStart = Number.isInteger(b.symbol.startLine)
      ? (b.symbol.startLine as number)
      : Number.MAX_SAFE_INTEGER;
    return aStart - bStart;
  });

  return candidates[0].symbol;
}
