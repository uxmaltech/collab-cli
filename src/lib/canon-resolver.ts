import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { CollabConfig } from './config';

const CANON_REPO_NAME = 'collab-architecture';
const CANONS_SUBDIR = 'canons';

const CANON_REPO_URL = 'https://github.com/uxmaltech/collab-architecture.git';
const CANON_BRANCH = 'main';
const ALLOWED_PREFIX = 'prompts/';

/**
 * Returns the base directory for the collab-architecture canon repo.
 * Respects the COLLAB_HOME environment variable, defaulting to ~/.collab.
 */
export function getCanonsBaseDir(): string {
  const collabHome = process.env.COLLAB_HOME ?? path.join(os.homedir(), '.collab');
  return path.join(collabHome, CANONS_SUBDIR, CANON_REPO_NAME);
}

/**
 * Checks whether the canons directory exists and contains prompts.
 */
export function isCanonsAvailable(): boolean {
  const dir = getCanonsBaseDir();
  return fs.existsSync(path.join(dir, 'prompts'));
}

/**
 * Clones or pulls the collab-architecture canons repository.
 * Returns true on success, false on failure.
 */
export function syncCanons(log?: (msg: string) => void): boolean {
  const canonsDir = getCanonsBaseDir();
  const parentDir = path.dirname(canonsDir);
  const print = log ?? console.log;

  try {
    if (fs.existsSync(path.join(canonsDir, '.git'))) {
      print(`Updating canons in ${canonsDir}...`);
      execFileSync('git', ['-C', canonsDir, 'fetch', 'origin', CANON_BRANCH], {
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      execFileSync('git', ['-C', canonsDir, 'checkout', CANON_BRANCH], {
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      execFileSync('git', ['-C', canonsDir, 'reset', '--hard', `origin/${CANON_BRANCH}`], {
        stdio: ['ignore', 'pipe', 'inherit'],
      });
    } else {
      print(`Cloning canons into ${canonsDir}...`);
      fs.mkdirSync(parentDir, { recursive: true });
      execFileSync(
        'git',
        ['clone', '--branch', CANON_BRANCH, '--single-branch', CANON_REPO_URL, canonsDir],
        { stdio: ['ignore', 'inherit', 'inherit'] },
      );
    }
    return true;
  } catch (err) {
    print(`Failed to sync canons: ${String(err)}`);
    return false;
  }
}

/**
 * Reads a prompt file from the canons directory.
 * Only files under prompts/ are allowed — canon content is never read directly.
 * Returns the file content as a string, or null if the file does not exist.
 */
export function resolveCanonFile(relativePath: string): string | null {
  if (!relativePath.startsWith(ALLOWED_PREFIX)) {
    throw new Error(
      `Canon resolver only allows reading from '${ALLOWED_PREFIX}'. ` +
        `Requested: '${relativePath}'. Canon content must never be copied to projects.`,
    );
  }

  const filePath = path.join(getCanonsBaseDir(), relativePath);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  return fs.readFileSync(filePath, 'utf8');
}

/** Directories and root files to copy from canon repo to target. */
const CANON_COPY_DIRS = [
  'domains',
  'knowledge',
  'contracts',
  'governance',
  'graph',
  'schema',
  'prompts',
  'embeddings',
  'evolution',
];

const CANON_COPY_ROOT_FILES = ['AGENTS.md', 'README.md'];

/**
 * Counts files recursively inside a directory.
 */
function countFiles(dir: string): number {
  if (!fs.existsSync(dir)) {
    return 0;
  }

  let count = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile()) {
      count++;
    } else if (entry.isDirectory()) {
      count += countFiles(path.join(dir, entry.name));
    }
  }

  return count;
}

/**
 * Copies the full collab-architecture canon content to a target directory.
 * This is used by the file-only pipeline to create `docs/architecture/uxmaltech/`.
 *
 * Copies: domains/, knowledge/, contracts/, governance/, graph/, schema/,
 * prompts/, embeddings/, evolution/, AGENTS.md, README.md
 *
 * Returns the number of files copied.
 */
export function copyCanonContent(targetDir: string, log?: (msg: string) => void): number {
  const sourceDir = getCanonsBaseDir();
  const print = log ?? (() => {});

  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Canon source not found at ${sourceDir}. Run syncCanons() first.`);
  }

  fs.mkdirSync(targetDir, { recursive: true });

  let totalFiles = 0;

  for (const dir of CANON_COPY_DIRS) {
    const src = path.join(sourceDir, dir);
    const dest = path.join(targetDir, dir);

    if (!fs.existsSync(src)) {
      continue;
    }

    fs.cpSync(src, dest, { recursive: true });
    const fileCount = countFiles(dest);
    totalFiles += fileCount;
    print(`  Copied ${dir}/ (${fileCount} files)`);
  }

  for (const file of CANON_COPY_ROOT_FILES) {
    const src = path.join(sourceDir, file);
    const dest = path.join(targetDir, file);

    if (!fs.existsSync(src)) {
      continue;
    }

    fs.copyFileSync(src, dest);
    totalFiles++;
    print(`  Copied ${file}`);
  }

  return totalFiles;
}

// ────────────────────────────────────────────────────────────────
// Business canon support
// ────────────────────────────────────────────────────────────────

/**
 * Returns true if the config has a business canon configured.
 */
export function isBusinessCanonConfigured(config: CollabConfig): boolean {
  return !!config.canons?.business?.repo;
}

/**
 * Returns the local directory where the business canon lives.
 * For local canons this is the user-provided path; for GitHub canons
 * it's the cached clone under `~/.collab/canons/<repo>`.
 */
export function getBusinessCanonDir(config: CollabConfig): string {
  const canon = config.canons?.business;
  if (!canon) {
    throw new Error('No business canon configured.');
  }

  // Local source: the user's directory as-is
  if (canon.source === 'local' && canon.localPath) {
    return canon.localPath;
  }

  // GitHub source: cached clone
  const repoName = canon.repo.split('/').pop() ?? canon.repo;
  const collabHome = process.env.COLLAB_HOME ?? path.join(os.homedir(), '.collab');
  return path.join(collabHome, CANONS_SUBDIR, repoName);
}

/**
 * Clones or pulls the business canon repository.
 * Uses the workspace GitHub token if available, otherwise falls back to default git credentials.
 */
export function syncBusinessCanon(
  config: CollabConfig,
  log?: (msg: string) => void,
  token?: string,
): boolean {
  const canon = config.canons?.business;
  if (!canon) {
    return false;
  }

  const print = log ?? console.log;

  // Local canons don't need syncing — just validate the path exists
  if (canon.source === 'local') {
    if (!canon.localPath || !fs.existsSync(canon.localPath)) {
      print(`Local canon path not found: ${canon.localPath ?? '(not set)'}`);
      return false;
    }
    print(`Using local business canon at ${canon.localPath}`);
    return true;
  }

  const canonsDir = getBusinessCanonDir(config);
  const parentDir = path.dirname(canonsDir);
  const branch = canon.branch || 'main';

  // Build repo URL — inject token for private repo access if available
  let repoUrl: string;
  if (token) {
    repoUrl = `https://x-access-token:${token}@github.com/${canon.repo}.git`;
  } else {
    repoUrl = `https://github.com/${canon.repo}.git`;
  }

  try {
    if (fs.existsSync(path.join(canonsDir, '.git'))) {
      print(`Updating business canon in ${canonsDir}...`);
      execFileSync('git', ['-C', canonsDir, 'fetch', 'origin', branch], {
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      execFileSync('git', ['-C', canonsDir, 'checkout', branch], {
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      execFileSync('git', ['-C', canonsDir, 'reset', '--hard', `origin/${branch}`], {
        stdio: ['ignore', 'pipe', 'inherit'],
      });
    } else {
      print(`Cloning business canon into ${canonsDir}...`);
      fs.mkdirSync(parentDir, { recursive: true });
      execFileSync(
        'git',
        ['clone', '--branch', branch, '--single-branch', repoUrl, canonsDir],
        { stdio: ['ignore', 'inherit', 'inherit'] },
      );
    }
    return true;
  } catch (err) {
    print(`Failed to sync business canon: ${String(err)}`);
    return false;
  }
}

/**
 * Copies the business canon content to a target directory.
 * Copies all directories and root files found in the canon.
 */
export function copyBusinessCanonContent(
  config: CollabConfig,
  targetDir: string,
  log?: (msg: string) => void,
): number {
  const sourceDir = getBusinessCanonDir(config);
  const print = log ?? (() => {});

  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Business canon source not found at ${sourceDir}. Run syncBusinessCanon() first.`);
  }

  fs.mkdirSync(targetDir, { recursive: true });

  let totalFiles = 0;

  // Copy same directories as framework canon (where they exist)
  for (const dir of CANON_COPY_DIRS) {
    const src = path.join(sourceDir, dir);
    const dest = path.join(targetDir, dir);

    if (!fs.existsSync(src)) {
      continue;
    }

    fs.cpSync(src, dest, { recursive: true });
    const fileCount = countFiles(dest);
    totalFiles += fileCount;
    print(`  Copied ${dir}/ (${fileCount} files)`);
  }

  for (const file of CANON_COPY_ROOT_FILES) {
    const src = path.join(sourceDir, file);
    const dest = path.join(targetDir, file);

    if (!fs.existsSync(src)) {
      continue;
    }

    fs.copyFileSync(src, dest);
    totalFiles++;
    print(`  Copied ${file}`);
  }

  return totalFiles;
}
