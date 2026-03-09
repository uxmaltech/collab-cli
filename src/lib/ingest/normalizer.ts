import { nodeLines, nodeText, type QueryMatch } from './tree-sitter-runner';
import type { AstNode, AstEdge } from './types';

function buildNodeId(repo: string, namespace: string | null, name: string): string {
  if (namespace) return `${repo}::${namespace}\\${name}`;
  return `${repo}::UNKNOWN::${name}`;
}

function extractPhpNamespace(sourceText: string): string | null {
  const match = String(sourceText).match(/^\s*namespace\s+([\w\\]+)\s*(?:;|\{)/m);
  return match ? match[1] : null;
}

function normalizePhpNodes(opts: {
  matches: QueryMatch[];
  sourceText: string;
  repo: string;
  sourcePath: string;
}): AstNode[] {
  const { matches, sourceText, repo, sourcePath } = opts;
  const namespace = extractPhpNamespace(sourceText);
  const nodes: AstNode[] = [];
  const seenIds = new Set<string>();

  for (const match of matches) {
    const captures = Object.fromEntries(match.captures.map((c) => [c.name, c.node]));

    if (captures['node.class']) {
      const name = nodeText(captures['node.class.name'], sourceText);
      const id = buildNodeId(repo, namespace, name);
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      const lines = nodeLines(captures['node.class']);
      nodes.push({
        id,
        tag: 'Class',
        properties: { name, type: 'class', path: sourcePath, ...lines },
        content: nodeText(captures['node.class'], sourceText),
      });
    } else if (captures['node.interface']) {
      const name = nodeText(captures['node.interface.name'], sourceText);
      const id = buildNodeId(repo, namespace, name);
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      const lines = nodeLines(captures['node.interface']);
      nodes.push({
        id,
        tag: 'Interface',
        properties: { name, path: sourcePath, ...lines },
        content: nodeText(captures['node.interface'], sourceText),
      });
    } else if (captures['node.trait']) {
      const name = nodeText(captures['node.trait.name'], sourceText);
      const id = buildNodeId(repo, namespace, name);
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      const lines = nodeLines(captures['node.trait']);
      nodes.push({
        id,
        tag: 'Trait',
        properties: { name, path: sourcePath, ...lines },
        content: nodeText(captures['node.trait'], sourceText),
      });
    } else if (captures['node.enum']) {
      const name = nodeText(captures['node.enum.name'], sourceText);
      const id = buildNodeId(repo, namespace, name);
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      const lines = nodeLines(captures['node.enum']);
      nodes.push({
        id,
        tag: 'Class',
        properties: { name, type: 'enum', path: sourcePath, ...lines },
        content: nodeText(captures['node.enum'], sourceText),
      });
    } else if (captures['node.function']) {
      const name = nodeText(captures['node.function.name'], sourceText);
      const id = `${buildNodeId(repo, namespace, 'UNKNOWN_CLASS')}::${name}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      const lines = nodeLines(captures['node.function']);
      nodes.push({
        id,
        tag: 'Function',
        properties: { name, visibility: 'public', path: sourcePath, ...lines },
        content: nodeText(captures['node.function'], sourceText),
      });
    }
  }

  return nodes;
}

function normalizePhpEdges(opts: {
  matches: QueryMatch[];
  sourceText: string;
  repo: string;
}): AstEdge[] {
  const { matches, sourceText, repo } = opts;
  const namespace = extractPhpNamespace(sourceText);
  const edges: AstEdge[] = [];

  for (const match of matches) {
    const captures = Object.fromEntries(match.captures.map((c) => [c.name, c.node]));

    if (captures['edge.extends.from'] && captures['edge.extends.to']) {
      const fromName = nodeText(captures['edge.extends.from'], sourceText);
      const toName = nodeText(captures['edge.extends.to'], sourceText);
      edges.push({
        from: buildNodeId(repo, namespace, fromName),
        to: `UNRESOLVED::${toName}`,
        type: 'EXTENDS',
        properties: {},
      });
    } else if (captures['edge.implements.from'] && captures['edge.implements.to']) {
      const fromName = nodeText(captures['edge.implements.from'], sourceText);
      const toName = nodeText(captures['edge.implements.to'], sourceText);
      edges.push({
        from: buildNodeId(repo, namespace, fromName),
        to: `UNRESOLVED::${toName}`,
        type: 'IMPLEMENTS',
        properties: {},
      });
    } else if (captures['edge.uses_trait.to']) {
      const traitName = nodeText(captures['edge.uses_trait.to'], sourceText);
      edges.push({
        from: `${repo}::UNKNOWN::UNKNOWN_CLASS`,
        to: `UNRESOLVED::${traitName}`,
        type: 'USES_TRAIT',
        properties: {},
      });
    } else if (captures['edge.uses_import.to']) {
      const fqcn = nodeText(captures['edge.uses_import.to'], sourceText);
      edges.push({
        from: buildNodeId(repo, namespace, 'UNKNOWN_CLASS'),
        to: `UNRESOLVED::${fqcn}`,
        type: 'USES',
        properties: { description: `use ${fqcn}` },
      });
    } else if (captures['edge.uses_import_group.to']) {
      const contextText = nodeText(captures['edge.uses_import_group.context'], sourceText);
      const prefixMatch = contextText.match(/use\s+([\w\\]+)\\\{/);
      const prefix = prefixMatch ? prefixMatch[1] : '';
      const clauseName = nodeText(captures['edge.uses_import_group.to'], sourceText).trim();
      const fqcn = prefix ? `${prefix}\\${clauseName}` : clauseName;
      edges.push({
        from: buildNodeId(repo, namespace, 'UNKNOWN_CLASS'),
        to: `UNRESOLVED::${fqcn}`,
        type: 'USES',
        properties: { description: `use ${fqcn}` },
      });
    }
  }

  return edges;
}

function normalizeTsNodes(opts: {
  matches: QueryMatch[];
  sourceText: string;
  repo: string;
  sourcePath: string;
}): AstNode[] {
  const { matches, sourceText, repo, sourcePath } = opts;
  const nodes: AstNode[] = [];
  const seenIds = new Set<string>();

  for (const match of matches) {
    const captures = Object.fromEntries(match.captures.map((c) => [c.name, c.node]));

    if (captures['node.class']) {
      const name = nodeText(captures['node.class.name'], sourceText);
      const id = `${repo}::${sourcePath}::${name}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      const lines = nodeLines(captures['node.class']);
      nodes.push({
        id,
        tag: 'Class',
        properties: { name, type: 'class', path: sourcePath, ...lines },
        content: nodeText(captures['node.class'], sourceText),
      });
    } else if (captures['node.interface']) {
      const name = nodeText(captures['node.interface.name'], sourceText);
      const id = `${repo}::${sourcePath}::${name}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      const lines = nodeLines(captures['node.interface']);
      nodes.push({
        id,
        tag: 'Interface',
        properties: { name, path: sourcePath, ...lines },
        content: nodeText(captures['node.interface'], sourceText),
      });
    } else if (captures['node.function']) {
      const name = nodeText(captures['node.function.name'], sourceText);
      const id = `${repo}::${sourcePath}::${name}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      const lines = nodeLines(captures['node.function']);
      nodes.push({
        id,
        tag: 'Function',
        properties: { name, visibility: 'public', path: sourcePath, ...lines },
        content: nodeText(captures['node.function'], sourceText),
      });
    }
  }

  return nodes;
}

function normalizeTsEdges(opts: {
  matches: QueryMatch[];
  sourceText: string;
  repo: string;
  sourcePath: string;
}): AstEdge[] {
  const { matches, sourceText, repo, sourcePath } = opts;
  const edges: AstEdge[] = [];

  for (const match of matches) {
    const captures = Object.fromEntries(match.captures.map((c) => [c.name, c.node]));

    if (captures['edge.extends.from'] && captures['edge.extends.to']) {
      const fromName = nodeText(captures['edge.extends.from'], sourceText);
      const toName = nodeText(captures['edge.extends.to'], sourceText);
      edges.push({
        from: `${repo}::${sourcePath}::${fromName}`,
        to: `UNRESOLVED::${toName}`,
        type: 'EXTENDS',
        properties: {},
      });
    } else if (captures['edge.implements.from'] && captures['edge.implements.to']) {
      const fromName = nodeText(captures['edge.implements.from'], sourceText);
      const toName = nodeText(captures['edge.implements.to'], sourceText);
      edges.push({
        from: `${repo}::${sourcePath}::${fromName}`,
        to: `UNRESOLVED::${toName}`,
        type: 'IMPLEMENTS',
        properties: {},
      });
    }
  }

  return edges;
}

export function normalizeFileMatches(opts: {
  repo: string;
  platform: string;
  sourcePath: string;
  sourceText: string;
  language: string;
  nodeMatches: QueryMatch[];
  edgeMatches: QueryMatch[];
}): { repo: string; platform: string; nodes: AstNode[]; edges: AstEdge[] } {
  const { repo, platform, sourcePath, sourceText, language, nodeMatches, edgeMatches } = opts;
  let nodes: AstNode[] = [];
  let edges: AstEdge[] = [];

  if (language === 'php') {
    nodes = normalizePhpNodes({ matches: nodeMatches, sourceText, repo, sourcePath });
    edges = normalizePhpEdges({ matches: edgeMatches, sourceText, repo });

    // Post-process: replace UNKNOWN_CLASS placeholders with the owning class.
    const classLikeNodes = nodes.filter(
      (n) => n.tag === 'Class' || n.tag === 'Trait' || n.tag === 'Interface',
    );

    if (classLikeNodes.length > 0) {
      const phpNamespace = extractPhpNamespace(sourceText);
      const resolvedIds = new Set(nodes.map((n) => n.id));
      const unknownClassOwnerMap = new Map<string, string>();

      for (const node of nodes) {
        if (node.tag === 'Function' && node.id.includes('UNKNOWN_CLASS')) {
          const originalUnknownId = buildNodeId(repo, phpNamespace, 'UNKNOWN_CLASS');
          const methodStart = (node.properties?.startLine as number) ?? 0;
          const owner = classLikeNodes.find((c) => {
            const cStart = (c.properties?.startLine as number) ?? 0;
            const cEnd = (c.properties?.endLine as number) ?? Infinity;
            return methodStart >= cStart && methodStart <= cEnd;
          });

          if (owner) {
            const newId = node.id.replace(originalUnknownId, owner.id);
            if (!resolvedIds.has(newId)) {
              resolvedIds.add(newId);
              unknownClassOwnerMap.set(node.id, owner.id);
              node.id = newId;
            }
          }
          // If no owner found by line range, leave the node.id unchanged
        }
      }

      // Only reassign edges where a specific owner was resolved
      if (unknownClassOwnerMap.size > 0) {
        const firstOwner = [...unknownClassOwnerMap.values()][0];
        for (const edge of edges) {
          if (edge.from.includes('UNKNOWN_CLASS')) {
            edge.from = firstOwner;
          }
        }
      }
    }
  } else if (language === 'typescript' || language === 'javascript') {
    nodes = normalizeTsNodes({ matches: nodeMatches, sourceText, repo, sourcePath });
    edges = normalizeTsEdges({ matches: edgeMatches, sourceText, repo, sourcePath });
  }

  return { repo, platform, nodes, edges };
}
