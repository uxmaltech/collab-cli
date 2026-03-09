import { runQuery, nodeText } from './tree-sitter-runner';
import { normalizeFileMatches } from './normalizer';
import type { AstNode, AstEdge, ExtractionResult } from './types';

const SUPPORTED_LANGUAGES = new Set(['php', 'typescript', 'javascript']);

export function isSupported(language: string): boolean {
  return SUPPORTED_LANGUAGES.has(language);
}

export async function extractFile(opts: {
  repo: string;
  platform: string;
  sourcePath: string;
  sourceText: string;
  language: string;
  laravel?: boolean;
}): Promise<ExtractionResult> {
  const { repo, platform, sourcePath, sourceText, language, laravel = false } = opts;

  if (!isSupported(language)) {
    return { repo, platform, nodes: [], edges: [], warning: `Unsupported language: ${language}` };
  }

  const [nodeMatches, edgeMatches] = await Promise.all([
    runQuery({ language, sourceText, queryFile: 'nodes.scm' }),
    runQuery({ language, sourceText, queryFile: 'edges.scm' }),
  ]);

  const result = normalizeFileMatches({
    repo,
    platform,
    sourcePath,
    sourceText,
    language,
    nodeMatches,
    edgeMatches,
  });

  // Laravel-specific extra edges (PHP only)
  if (laravel && language === 'php') {
    try {
      const laravelMatches = await runQuery({ language, sourceText, queryFile: 'laravel.scm' });
      for (const match of laravelMatches) {
        const caps = Object.fromEntries(match.captures.map((c) => [c.name, c.node]));
        if (caps['edge.dispatches.event']) {
          const eventName = nodeText(caps['edge.dispatches.event'], sourceText);
          result.edges.push({
            from: `${repo}::UNKNOWN`,
            to: `UNRESOLVED::${eventName}`,
            type: 'DISPATCHES',
            properties: {},
          });
        }
        if (caps['edge.triggers.job']) {
          const jobName = nodeText(caps['edge.triggers.job'], sourceText);
          result.edges.push({
            from: `${repo}::UNKNOWN`,
            to: `UNRESOLVED::${jobName}`,
            type: 'TRIGGERS',
            properties: {},
          });
        }
        if (caps['edge.route.method'] && caps['edge.route.uri']) {
          const method = nodeText(caps['edge.route.method'], sourceText);
          const uri = nodeText(caps['edge.route.uri'], sourceText);
          result.edges.push({
            from: `${repo}::UNKNOWN`,
            to: `UNRESOLVED::Route::${method}`,
            type: 'ROUTE',
            properties: { method, uri },
          });
        }
      }
    } catch {
      // laravel.scm is best-effort; ignore parse/query errors
    }
  }

  return result;
}

export function mergeExtractions(
  extractions: ExtractionResult[],
): { repo: string; platform: string; nodes: AstNode[]; edges: AstEdge[] } {
  const nodesById = new Map<string, AstNode>();
  const edges: AstEdge[] = [];

  for (const { nodes, edges: fileEdges } of extractions) {
    for (const node of nodes) {
      if (!nodesById.has(node.id)) nodesById.set(node.id, node);
    }
    edges.push(...fileEdges);
  }

  const first = extractions[0] || ({} as Partial<ExtractionResult>);
  return {
    repo: first.repo ?? '',
    platform: first.platform ?? '',
    nodes: [...nodesById.values()],
    edges,
  };
}
