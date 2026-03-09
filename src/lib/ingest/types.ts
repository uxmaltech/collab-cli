export interface AstNode {
  id: string;
  tag: string;
  properties: Record<string, unknown>;
  content: string;
}

export interface AstEdge {
  from: string;
  to: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface ExtractionResult {
  repo: string;
  platform: string;
  nodes: AstNode[];
  edges: AstEdge[];
  warning?: string;
}

export interface IngestAstPayload {
  context: string;
  scope: string;
  organization: string;
  repo: string;
  nodes: AstNode[];
  edges: AstEdge[];
}

export interface IngestMarkdownDocument {
  path: string;
  content: string;
  language?: string;
  contentKind?: string;
}

export interface IngestMarkdownPayload {
  context: string;
  scope: string;
  organization: string;
  repo: string;
  documents: IngestMarkdownDocument[];
}

export interface ChunkWithRange {
  text: string;
  startLine: number;
  endLine: number;
}

export interface ParagraphWithRange {
  text: string;
  startLine: number;
  endLine: number;
}

export interface SymbolInfo {
  kind: string;
  name: string;
  path: string;
  startLine: number | null;
  endLine: number | null;
}

export interface SymbolExtractionResult {
  parser: string | null;
  symbols: SymbolInfo[];
  warning: string | null;
}

export type Platform = 'laravel' | 'php' | 'node' | 'kotlin' | 'swift' | 'unknown';
