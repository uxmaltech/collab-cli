import type { ChunkWithRange, ParagraphWithRange } from './types';

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function splitParagraphsWithRanges(text: string): ParagraphWithRange[] {
  const lines = String(text || '').split('\n');
  const paragraphs: ParagraphWithRange[] = [];
  let index = 0;

  while (index < lines.length) {
    while (index < lines.length && !lines[index].trim()) {
      index += 1;
    }
    if (index >= lines.length) break;

    const start = index;
    const body: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      body.push(lines[index]);
      index += 1;
    }

    paragraphs.push({
      text: body.join('\n').trim(),
      startLine: start + 1,
      endLine: index,
    });
  }

  return paragraphs.filter((entry) => entry.text);
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function chunkTextWithRanges(
  text: string,
  targetTokens = 350,
  overlapTokens = 40,
): ChunkWithRange[] {
  const paragraphs = splitParagraphsWithRanges(text);
  const chunks: ChunkWithRange[] = [];
  let current: ParagraphWithRange[] = [];
  let currentTokens = 0;

  function pushCurrentChunk(): void {
    if (!current.length) return;
    chunks.push({
      text: current.map((item) => item.text).join('\n\n'),
      startLine: current[0].startLine,
      endLine: current[current.length - 1].endLine,
    });
  }

  for (const paragraph of paragraphs) {
    const paragraphTokens = estimateTokens(paragraph.text);
    if (currentTokens + paragraphTokens > targetTokens && current.length) {
      pushCurrentChunk();

      const overlap: ParagraphWithRange[] = [];
      if (overlapTokens > 0) {
        let overlapTokenCount = 0;
        for (let i = current.length - 1; i >= 0; i -= 1) {
          const candidate = current[i];
          const candidateTokens = estimateTokens(candidate.text);

          // Skip oversized paragraphs that alone exceed the overlap budget
          if (overlapTokenCount === 0 && candidateTokens > overlapTokens) break;
          if (overlapTokenCount + candidateTokens > overlapTokens) break;

          overlap.unshift(candidate);
          overlapTokenCount += candidateTokens;
          if (overlapTokenCount >= overlapTokens) break;
        }
      }

      current = overlap.length ? [...overlap, paragraph] : [paragraph];
      currentTokens = current.reduce((sum, item) => sum + estimateTokens(item.text), 0);
      continue;
    }

    current.push(paragraph);
    currentTokens += paragraphTokens;
  }

  pushCurrentChunk();
  return chunks.filter((chunk) => chunk.text && chunk.text.trim());
}

export function chunkText(text: string, targetTokens = 350, overlapTokens = 40): string[] {
  return chunkTextWithRanges(text, targetTokens, overlapTokens).map((chunk) => chunk.text);
}
