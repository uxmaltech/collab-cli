import path from 'node:path';

/**
 * Defines a canonical index target: a directory to scan for canon entries
 * and the README.md to generate/validate.
 */
export interface CanonIndexTarget {
  /** Directory to scan for .md canon entry files. */
  scanDir: string;
  /** Path to the README.md index file to generate. */
  outputFile: string;
  /** Section heading in the generated README. */
  sectionTitle: string;
  /** One-line description for the generated README. */
  description: string;
}

/**
 * Returns the canonical index targets for a given architecture directory.
 * This is the single source of truth for which index files are
 * generated/snapshotted/validated across canon rebuild stages.
 */
export function getCanonIndexTargets(archDir: string): CanonIndexTarget[] {
  return [
    {
      scanDir: path.join(archDir, 'knowledge', 'axioms'),
      outputFile: path.join(archDir, 'knowledge', 'axioms', 'README.md'),
      sectionTitle: 'Axioms',
      description: 'Fundamental architectural invariants that MUST always hold.',
    },
    {
      scanDir: path.join(archDir, 'knowledge', 'decisions'),
      outputFile: path.join(archDir, 'knowledge', 'decisions', 'README.md'),
      sectionTitle: 'Architectural Decisions',
      description: 'ADRs documenting key architectural choices and their rationale.',
    },
    {
      scanDir: path.join(archDir, 'knowledge', 'conventions'),
      outputFile: path.join(archDir, 'knowledge', 'conventions', 'README.md'),
      sectionTitle: 'Conventions',
      description: 'Coding and design conventions followed across this codebase.',
    },
    {
      scanDir: path.join(archDir, 'knowledge', 'anti-patterns'),
      outputFile: path.join(archDir, 'knowledge', 'anti-patterns', 'README.md'),
      sectionTitle: 'Anti-Patterns',
      description: 'Known pitfalls and patterns that MUST be avoided.',
    },
    {
      scanDir: path.join(archDir, 'domains'),
      outputFile: path.join(archDir, 'domains', 'README.md'),
      sectionTitle: 'Domains',
      description: 'Bounded contexts and domain boundaries identified in the architecture.',
    },
    {
      scanDir: path.join(archDir, 'contracts'),
      outputFile: path.join(archDir, 'contracts', 'README.md'),
      sectionTitle: 'Contracts',
      description: 'Interface contracts between domains (UI-backend shapes, command outcomes).',
    },
  ];
}

/**
 * Returns relative paths of all README files to snapshot during rebuild.
 * Includes top-level and parent READMEs that are not auto-generated
 * but should be preserved for rollback.
 */
export function getSnapshotIndexPaths(archDir: string): string[] {
  // Top-level hand-crafted READMEs (not regenerable, but worth snapshotting)
  const topLevel = [
    'README.md',
    'knowledge/README.md',
  ];

  // Auto-generated sub-category READMEs (from getCanonIndexTargets)
  const generated = getCanonIndexTargets(archDir).map(
    (t) => path.relative(archDir, t.outputFile),
  );

  return [...topLevel, ...generated];
}
