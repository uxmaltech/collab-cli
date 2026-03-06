import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { CliError } from './errors';
import type { Logger } from './logger';

const GITHUB_API_VERSION = '2022-11-28';
const ACCESS_CHECK_TIMEOUT_MS = 10_000;

// ────────────────────────────────────────────────────────────────
// Remote URL normalization
// ────────────────────────────────────────────────────────────────

/**
 * Normalizes a git remote URL to a GitHub `owner/repo` slug.
 * Handles HTTPS, SSH (`git@`), and `ssh://` URL formats.
 * Returns `null` if the remote is not a `github.com` URL.
 */
export function normalizeGitHubRemote(remoteUrl: string): string | null {
  if (!/github\.com[:/]/i.test(remoteUrl)) {
    return null;
  }

  const slug = remoteUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/^ssh:\/\/git@github\.com\//i, '');

  const parts = slug.split('/').filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  return `${parts[0]}/${parts[1]}`;
}

// ────────────────────────────────────────────────────────────────
// Local repo → GitHub identity
// ────────────────────────────────────────────────────────────────

export interface GitHubRepoIdentity {
  owner: string;
  repo: string;
  /** `owner/repo` slug */
  slug: string;
}

/**
 * Reads the `origin` remote URL of a local git repo and extracts
 * the GitHub owner/repo identity.
 * Returns `null` if the repo has no git origin, no remote, or a non-GitHub remote.
 */
export function resolveGitHubOwnerRepo(repoDir: string): GitHubRepoIdentity | null {
  let remoteUrl: string;
  try {
    remoteUrl = execFileSync(
      'git',
      ['-C', repoDir, 'remote', 'get-url', 'origin'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    return null;
  }

  const slug = normalizeGitHubRemote(remoteUrl);
  if (!slug) {
    return null;
  }

  const [owner, repo] = slug.split('/');
  return { owner, repo, slug };
}

// ────────────────────────────────────────────────────────────────
// GitHub access verification
// ────────────────────────────────────────────────────────────────

/**
 * Verifies the GitHub token has read access to the given repo.
 * Returns `true` if `GET /repos/{slug}` returns 200.
 */
export async function verifyGitHubAccess(slug: string, token: string): Promise<boolean> {
  const url = `https://api.github.com/repos/${slug}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACCESS_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
      },
      signal: controller.signal,
    });

    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ────────────────────────────────────────────────────────────────
// Workspace repo validation
// ────────────────────────────────────────────────────────────────

/**
 * Validates that workspace repos have GitHub origin remotes with token access.
 * Returns only the repos that pass. Throws `CliError` if zero repos pass.
 */
export async function validateWorkspaceRepos(
  repoNames: string[],
  workspaceDir: string,
  token: string,
  logger: Logger,
): Promise<string[]> {
  const valid: string[] = [];
  const excluded: { name: string; reason: string }[] = [];

  for (const name of repoNames) {
    const repoDir = path.join(workspaceDir, name);
    const identity = resolveGitHubOwnerRepo(repoDir);

    if (!identity) {
      excluded.push({ name, reason: 'no GitHub remote' });
      logger.warn(`Excluding "${name}": no GitHub origin remote found.`);
      continue;
    }

    const hasAccess = await verifyGitHubAccess(identity.slug, token);
    if (!hasAccess) {
      excluded.push({ name, reason: `no access to ${identity.slug}` });
      logger.warn(`Excluding "${name}" (${identity.slug}): GitHub token lacks access.`);
      continue;
    }

    logger.info(`Repo "${name}" (${identity.slug}): GitHub access verified.`);
    valid.push(name);
  }

  if (excluded.length > 0) {
    logger.info(`Excluded ${excluded.length} repo(s): ${excluded.map((e) => `${e.name} (${e.reason})`).join(', ')}`);
  }

  if (valid.length === 0) {
    throw new CliError(
      'No repos in the workspace have a valid GitHub remote with token access.\n' +
        'Indexed mode requires at least 1 governed GitHub repo in addition to the business canon.\n' +
        'Clone your repos from GitHub and re-run.',
    );
  }

  logger.info(`Found ${valid.length} governed repo(s): ${valid.join(', ')}`);
  return valid;
}
