import fs from 'node:fs';
import path from 'node:path';

export interface CanonEntry {
  id: string;
  title: string;
  confidence: string;
  status: string;
  fileName: string;
}

/**
 * Scans .md files in a directory and extracts canon entry metadata.
 * Parses the heading (# ID Title) and plain-text Status/Confidence fields.
 * Skips README.md files.
 */
export function scanCanonEntries(dir: string): CanonEntry[] {
  if (!fs.existsSync(dir)) return [];

  const entries: CanonEntry[] = [];
  const files = fs.readdirSync(dir).filter(
    (f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md',
  );

  for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file), 'utf8');

    // Parse heading: "# AX-001 Authoritative Canon" or "# ADR-006 Collab: ..."
    const heading = content.match(/^#\s+(.+)/m);
    if (!heading) continue;

    const headingText = heading[1].trim();
    // Match "ID Title" where ID is like AX-001, ADR-006, CN-002, AP-003, UIC-001, etc.
    const parts = headingText.match(/^([A-Z]+-\d+)\s+(.+)$/);
    const id = parts?.[1] ?? file.replace(/\.md$/, '');
    const title = parts?.[2] ?? headingText;

    // Parse plain-text fields (not bold)
    const confidence = content.match(/^Confidence:\s*(\w+)/mi)?.[1] ?? 'unknown';
    const status = content.match(/^Status:\s*(\w+)/mi)?.[1] ?? 'active';

    entries.push({ id, title, confidence, status, fileName: file });
  }

  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Generates a README.md index table from scanned canon entries.
 */
export function generateIndexReadme(
  sectionTitle: string,
  description: string,
  entries: CanonEntry[],
): string {
  const lines: string[] = [
    `# ${sectionTitle}`,
    '',
    `> ${description}`,
    '',
  ];

  if (entries.length === 0) {
    lines.push('_No entries yet._');
    lines.push('');
    lines.push('<!-- GENERATED: INDEX -->');
    return lines.join('\n');
  }

  lines.push('| ID | Title | Confidence | Status |');
  lines.push('|----|-------|------------|--------|');

  for (const e of entries) {
    lines.push(`| ${e.id} | [${e.title}](./${e.fileName}) | ${e.confidence} | ${e.status} |`);
  }

  lines.push('');
  lines.push(`_${entries.length} entries indexed._`);
  lines.push('');
  lines.push('<!-- GENERATED: INDEX -->');

  return lines.join('\n');
}
