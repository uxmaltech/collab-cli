export const EXCLUDED_DIRS = new Set([
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
  '.collab',
  '.claude',
]);

export const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.php',
  '.py', '.go', '.java', '.kt', '.rb',
  '.md', '.mdx',
  '.yml', '.yaml', '.json',
  '.sql', '.sh', '.bash',
]);

export const MAX_FILE_SIZE_BYTES = 512 * 1024; // 512 KB
export const MAX_DOCUMENTS_PER_BATCH = 50;
