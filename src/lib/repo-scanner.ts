import fs from 'node:fs';
import path from 'node:path';

/** Directories always excluded from scanning. */
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  'coverage',
  '__pycache__',
  '.venv',
  'vendor',
  'target',
]);

/** File extensions considered for context. */
const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.rb',
  '.php',
  '.vue',
  '.svelte',
]);

const CONFIG_FILES = [
  'package.json',
  'tsconfig.json',
  'Cargo.toml',
  'composer.json',
  'go.mod',
  'Gemfile',
  'requirements.txt',
  'pyproject.toml',
  '.eslintrc.json',
  '.prettierrc',
];

export interface RepoContext {
  name: string;
  language: string;
  framework: string | null;
  dependencies: string[];
  structure: string;
  keyFiles: string[];
  totalSourceFiles: number;
}

interface ScanOptions {
  /** Approximate max characters for the structure summary. Default 4000 */
  budgetChars?: number;
}

/**
 * Detects the primary language and framework from manifest files.
 */
function detectStack(workspaceDir: string): { language: string; framework: string | null; dependencies: string[] } {
  const pkgPath = path.join(workspaceDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      };

      const depNames = Object.keys(deps);
      const language = depNames.some((d) => d === 'typescript' || d.startsWith('@types/'))
        ? 'TypeScript'
        : 'JavaScript';

      let framework: string | null = null;
      if (depNames.includes('next')) framework = 'Next.js';
      else if (depNames.includes('nuxt')) framework = 'Nuxt';
      else if (depNames.includes('react')) framework = 'React';
      else if (depNames.includes('vue')) framework = 'Vue';
      else if (depNames.includes('svelte')) framework = 'Svelte';
      else if (depNames.includes('express')) framework = 'Express';
      else if (depNames.includes('fastify')) framework = 'Fastify';
      else if (depNames.includes('commander')) framework = 'CLI (Commander)';

      return { language, framework, dependencies: depNames.slice(0, 30) };
    } catch {
      // Fall through
    }
  }

  const cargoPath = path.join(workspaceDir, 'Cargo.toml');
  if (fs.existsSync(cargoPath)) {
    return { language: 'Rust', framework: null, dependencies: [] };
  }

  const goModPath = path.join(workspaceDir, 'go.mod');
  if (fs.existsSync(goModPath)) {
    return { language: 'Go', framework: null, dependencies: [] };
  }

  const pyprojectPath = path.join(workspaceDir, 'pyproject.toml');
  const requirementsPath = path.join(workspaceDir, 'requirements.txt');
  if (fs.existsSync(pyprojectPath) || fs.existsSync(requirementsPath)) {
    return { language: 'Python', framework: null, dependencies: [] };
  }

  const composerPath = path.join(workspaceDir, 'composer.json');
  if (fs.existsSync(composerPath)) {
    return { language: 'PHP', framework: null, dependencies: [] };
  }

  return { language: 'Unknown', framework: null, dependencies: [] };
}

/**
 * Walks the file tree and returns a structured summary.
 */
function walkTree(
  dir: string,
  rootDir: string,
  depth: number,
  maxDepth: number,
): { lines: string[]; sourceFiles: string[] } {
  const lines: string[] = [];
  const sourceFiles: string[] = [];

  if (depth > maxDepth) {
    return { lines, sourceFiles };
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { lines, sourceFiles };
  }

  // Sort: directories first, then files
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  const indent = '  '.repeat(depth);

  for (const entry of entries) {
    if (entry.name.startsWith('.') && depth === 0 && entry.name !== '.github') {
      continue;
    }

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;

      lines.push(`${indent}${entry.name}/`);
      const sub = walkTree(path.join(dir, entry.name), rootDir, depth + 1, maxDepth);
      lines.push(...sub.lines);
      sourceFiles.push(...sub.sourceFiles);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (SOURCE_EXTENSIONS.has(ext) || CONFIG_FILES.includes(entry.name)) {
        const relPath = path.relative(rootDir, path.join(dir, entry.name));
        sourceFiles.push(relPath);

        if (depth <= maxDepth) {
          lines.push(`${indent}${entry.name}`);
        }
      }
    }
  }

  return { lines, sourceFiles };
}

/**
 * Scans a repository and produces a structured context for AI analysis.
 */
export function scanRepository(workspaceDir: string, options: ScanOptions = {}): RepoContext {
  const budgetChars = options.budgetChars ?? 4000;
  const repoName = path.basename(workspaceDir);
  const stack = detectStack(workspaceDir);

  const { lines, sourceFiles } = walkTree(workspaceDir, workspaceDir, 0, 4);

  // Trim structure to budget
  let structure = lines.join('\n');
  if (structure.length > budgetChars) {
    structure = structure.slice(0, budgetChars) + '\n... (truncated)';
  }

  // Identify key files (entry points, configs, main modules)
  const keyFilePatterns = [
    /^src\/index\.\w+$/,
    /^src\/main\.\w+$/,
    /^src\/app\.\w+$/,
    /^index\.\w+$/,
    /^main\.\w+$/,
    /package\.json$/,
    /tsconfig\.json$/,
    /README\.md$/i,
  ];

  const keyFiles = sourceFiles
    .filter((f) => keyFilePatterns.some((p) => p.test(f)))
    .slice(0, 10);

  return {
    name: repoName,
    language: stack.language,
    framework: stack.framework,
    dependencies: stack.dependencies,
    structure,
    keyFiles,
    totalSourceFiles: sourceFiles.length,
  };
}
