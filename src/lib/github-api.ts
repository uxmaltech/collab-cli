import { execFileSync } from 'node:child_process';
import path from 'node:path';

import type { GitHubConfig } from './config';
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

// ────────────────────────────────────────────────────────────────
// GitHub repo info
// ────────────────────────────────────────────────────────────────

export interface RepoInfo {
  default_branch: string;
  allow_merge_commit: boolean;
  allow_squash_merge: boolean;
  allow_rebase_merge: boolean;
  delete_branch_on_merge: boolean;
}

/**
 * Fetches repository metadata from the GitHub API.
 */
export async function getRepoInfo(slug: string, token: string): Promise<RepoInfo> {
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

    if (!response.ok) {
      throw new CliError(`GitHub API error ${response.status} for ${slug}: ${response.statusText}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    return {
      default_branch: data.default_branch as string,
      allow_merge_commit: data.allow_merge_commit as boolean,
      allow_squash_merge: data.allow_squash_merge as boolean,
      allow_rebase_merge: data.allow_rebase_merge as boolean,
      delete_branch_on_merge: data.delete_branch_on_merge as boolean,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ────────────────────────────────────────────────────────────────
// Branch operations
// ────────────────────────────────────────────────────────────────

/**
 * Gets the SHA of a branch ref. Returns `null` if the branch does not exist (404).
 */
export async function getBranchRef(slug: string, branch: string, token: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${slug}/git/ref/heads/${branch}`;
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

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new CliError(`GitHub API error ${response.status} checking branch ${branch} for ${slug}`);
    }

    const data = (await response.json()) as { object: { sha: string } };
    return data.object.sha;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Creates a new branch from a given SHA. Idempotent: swallows 422 "Reference already exists".
 */
export async function createBranch(slug: string, branch: string, fromSha: string, token: string): Promise<void> {
  const url = `https://api.github.com/repos/${slug}/git/refs`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACCESS_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: fromSha }),
      signal: controller.signal,
    });

    // 422 = "Reference already exists" — idempotent, safe to ignore
    if (response.status === 422) {
      return;
    }
    if (!response.ok) {
      throw new CliError(`GitHub API error ${response.status} creating branch ${branch} for ${slug}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

// ────────────────────────────────────────────────────────────────
// Repo configuration
// ────────────────────────────────────────────────────────────────

/**
 * Sets the default branch for a repository.
 * Idempotent: skips if already set.
 */
export async function setDefaultBranch(slug: string, branch: string, token: string): Promise<void> {
  const url = `https://api.github.com/repos/${slug}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACCESS_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ default_branch: branch }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new CliError(`GitHub API error ${response.status} setting default branch for ${slug}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Applies branch protection rules. PUT is idempotent by HTTP spec.
 */
export async function setBranchProtection(
  slug: string,
  branch: string,
  token: string,
  githubConfig?: GitHubConfig,
): Promise<void> {
  const url = `https://api.github.com/repos/${slug}/branches/${branch}/protection`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACCESS_CHECK_TIMEOUT_MS);

  const checks = githubConfig?.requiredStatusChecks;
  const requiredStatusChecks = checks && checks.length > 0
    ? { strict: true, contexts: checks }
    : null;

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        required_status_checks: requiredStatusChecks,
        enforce_admins: githubConfig?.enforceAdmins ?? false,
        required_pull_request_reviews: {
          required_approving_review_count: githubConfig?.requiredApprovals ?? 1,
          dismiss_stale_reviews: githubConfig?.dismissStaleReviews ?? true,
        },
        restrictions: null,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new CliError(`GitHub API error ${response.status} setting branch protection on ${branch} for ${slug}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Configures merge strategy: only merge commits, no squash/rebase, delete branch on merge.
 * PATCH is safe to repeat.
 */
export async function setMergeStrategy(slug: string, token: string): Promise<void> {
  const url = `https://api.github.com/repos/${slug}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACCESS_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        allow_merge_commit: true,
        allow_squash_merge: false,
        allow_rebase_merge: false,
        delete_branch_on_merge: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new CliError(`GitHub API error ${response.status} setting merge strategy for ${slug}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Orchestrates full GitHub configuration for a single repo:
 * branch model → default branch → protection → merge strategy.
 */
export async function configureRepo(slug: string, token: string, logger: Logger, githubConfig?: GitHubConfig): Promise<void> {
  logger.info(`Configuring branch model for ${slug}...`);

  // 1. Get current repo info
  const info = await getRepoInfo(slug, token);

  // 2. Ensure both branches exist
  const mainSha = await getBranchRef(slug, 'main', token);
  const devSha = await getBranchRef(slug, 'development', token);

  if (!mainSha && !devSha) {
    // Neither exists — get the current default branch SHA and create both
    const defaultSha = await getBranchRef(slug, info.default_branch, token);
    if (!defaultSha) {
      throw new CliError(`Cannot resolve SHA for default branch "${info.default_branch}" of ${slug}`);
    }
    await createBranch(slug, 'main', defaultSha, token);
    logger.info(`  Created branch "main" from "${info.default_branch}".`);
    await createBranch(slug, 'development', defaultSha, token);
    logger.info(`  Created branch "development" from "${info.default_branch}".`);
  } else if (!mainSha && devSha) {
    await createBranch(slug, 'main', devSha, token);
    logger.info(`  Created branch "main" from "development".`);
  } else if (mainSha && !devSha) {
    await createBranch(slug, 'development', mainSha, token);
    logger.info(`  Created branch "development" from "main".`);
  } else {
    logger.info(`  Branches "main" and "development" already exist.`);
  }

  // 3. Set default branch to development
  if (info.default_branch !== 'development') {
    await setDefaultBranch(slug, 'development', token);
    logger.info(`  Set default branch to "development" (was "${info.default_branch}").`);
  } else {
    logger.info(`  Default branch is already "development".`);
  }

  // 4. Protect main
  await setBranchProtection(slug, 'main', token, githubConfig);
  const approvals = githubConfig?.requiredApprovals ?? 1;
  logger.info(`  Applied branch protection on "main" (${approvals} review${approvals !== 1 ? 's' : ''} required).`);

  // 5. Merge strategy
  await setMergeStrategy(slug, token);
  logger.info(`  Merge strategy: merge-commit only, delete branch on merge.`);
}
