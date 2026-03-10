import { spawn, execFileSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

import type { CanonsConfig, CollabConfig } from '../../lib/config';
import { CliError } from '../../lib/errors';
import { searchGitHubRepos, listGitHubBranches } from '../../lib/github-search';
import {
  getAuthenticatedUser,
  listUserOrgs,
  createGitHubRepo,
  createInitialReadme,
} from '../../lib/github-api';
import { loadGitHubAuth, isGitHubAuthValid, runGitHubDeviceFlow } from '../../lib/github-auth';
import type { CollabMode } from '../../lib/mode';
import type { Logger } from '../../lib/logger';
import { promptChoice, promptText, promptBoolean } from '../../lib/prompt';
import { withSpinner } from '../../lib/spinner';

import { LOCAL_PATH_RE } from './types';

/**
 * Expands `~`, resolves to absolute, and validates the path is an existing directory.
 * Throws CliError on failure.
 */
function resolveLocalCanonPath(rawPath: string): string {
  const resolved = path.resolve(rawPath.replace(/^~/, os.homedir()));
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new CliError(`Not a valid directory: ${resolved}`);
  }
  return resolved;
}

export function parseBusinessCanonOption(
  value: string | undefined,
  mode: CollabMode = 'file-only',
): CanonsConfig | undefined {
  if (mode === 'indexed') {
    if (!value || value === 'none' || value === 'skip') {
      throw new CliError(
        'Business canon is required for indexed mode. Use --business-canon owner/repo.',
      );
    }
    if (LOCAL_PATH_RE.test(value)) {
      throw new CliError(
        'Local business canon is not supported in indexed mode. Use --business-canon owner/repo (GitHub).',
      );
    }
  }

  if (!value || value === 'none' || value === 'skip') {
    return undefined;
  }

  // Detect local path: starts with /, ./, ../, or ~
  if (LOCAL_PATH_RE.test(value)) {
    const resolved = resolveLocalCanonPath(value);
    return {
      business: {
        repo: `local/${path.basename(resolved)}`,
        branch: 'local',
        localDir: 'business',
        source: 'local',
        localPath: resolved,
      },
    };
  }

  // GitHub repo: must contain /
  if (!value.includes('/')) {
    throw new CliError(
      `Invalid business canon format "${value}". Use "owner/repo", a local path, or "none" to skip.`,
    );
  }

  return {
    business: {
      repo: value,
      branch: 'main',
      localDir: 'business',
      source: 'github',
    },
  };
}

export async function resolveBusinessCanon(
  options: { businessCanon?: string; yes?: boolean },
  config: CollabConfig,
  logger: Logger,
): Promise<CanonsConfig | undefined> {
  const isIndexed = config.mode === 'indexed';

  // CLI flag takes priority
  if (options.businessCanon) {
    return parseBusinessCanonOption(options.businessCanon, config.mode);
  }

  // --yes without --business-canon: mandatory error
  if (options.yes) {
    if (isIndexed) {
      throw new CliError(
        '--business-canon owner/repo is required with --yes in indexed mode.',
      );
    }
    throw new CliError(
      '--business-canon is required with --yes. Use --business-canon owner/repo, --business-canon /local/path, or --business-canon none.',
    );
  }

  // Interactive indexed: go straight to GitHub search (no local/skip options)
  if (isIndexed) {
    logger.info('Indexed mode requires a GitHub business canon.');
    return resolveGitHubBusinessCanon(config, logger);
  }

  // Interactive file-only: choose source
  const source = await promptChoice(
    'Business canon source:',
    [
      { value: 'github', label: 'GitHub repository (search and select)' },
      { value: 'local', label: 'Local directory' },
      { value: 'skip', label: 'Skip (no business canon)' },
    ],
    'skip',
  );

  if (source === 'skip') {
    logger.info('No business canon configured.');
    return undefined;
  }

  if (source === 'local') {
    return resolveLocalBusinessCanon(logger);
  }

  return resolveGitHubBusinessCanon(config, logger);
}

async function resolveLocalBusinessCanon(logger: Logger): Promise<CanonsConfig> {
  const rawPath = await promptText('Local canon directory path:');
  if (!rawPath) {
    throw new CliError('Path is required for local canon.');
  }

  const resolved = resolveLocalCanonPath(rawPath);
  const dirName = path.basename(resolved);
  logger.info(`Using local canon at ${resolved}`);

  return {
    business: {
      repo: `local/${dirName}`,
      branch: 'local',
      localDir: 'business',
      source: 'local',
      localPath: resolved,
    },
  };
}

async function resolveGitHubBusinessCanon(
  config: CollabConfig,
  logger: Logger,
): Promise<CanonsConfig> {
  // Ensure GitHub auth
  const token = await ensureGitHubAuth(config.collabDir, logger);

  // Choose action: search or create
  const action = await promptChoice(
    'Business canon repository:',
    [
      { value: 'search', label: 'Search existing repository' },
      { value: 'create', label: 'Create new repository' },
    ],
    'search',
  );

  let repo: string;
  let defaultBranch = 'main';

  if (action === 'create') {
    const result = await createNewBusinessCanonRepo(token, logger);
    repo = result.fullName;
    defaultBranch = result.defaultBranch;
  } else {
    const result = await searchAndSelectRepo(token, logger);
    repo = result.repo;
    defaultBranch = result.defaultBranch;
  }

  // Fetch real branches so the user picks from existing ones
  const branches = await withSpinner(
    'Fetching branches...',
    () => listGitHubBranches(repo, token, defaultBranch),
    logger.verbosity === 'quiet',
  );

  let effectiveBranch: string;

  if (branches.length === 0) {
    // Empty repo — offer to create initial branch with README.md
    const branchName = await promptText('Branch name for initial commit:', 'main');
    const proceed = await promptBoolean(
      `Create branch "${branchName}" with a README.md placeholder?`,
      true,
    );

    if (!proceed) {
      throw new CliError('Cannot clone a repository with no branches. Create a branch first.');
    }

    await withSpinner(
      `Creating initial commit on "${branchName}"...`,
      () => createInitialReadme(repo, branchName, token),
      logger.verbosity === 'quiet',
    );

    logger.info(`Created branch "${branchName}" with README.md.`);
    effectiveBranch = branchName;
  } else if (branches.length === 1) {
    effectiveBranch = branches[0];
    logger.info(`Branch: ${effectiveBranch}`);
  } else {
    const branchChoices = branches.map((b) => ({
      value: b,
      label: b === defaultBranch ? `${b} (default)` : b,
    }));
    effectiveBranch = await promptChoice('Branch:', branchChoices, branches[0]);
  }

  // Clone immediately so workspace detection finds the repo
  await cloneGitHubRepo(repo, effectiveBranch, config.workspaceDir, token, logger);

  return {
    business: {
      repo,
      branch: effectiveBranch,
      localDir: 'business',
      source: 'github',
    },
  };
}

/**
 * Interactive GitHub search loop: search → select from results → return repo slug.
 */
async function searchAndSelectRepo(
  token: string,
  logger: Logger,
): Promise<{ repo: string; defaultBranch: string }> {
  let repo: string | undefined;
  let defaultBranch = 'main';

  while (!repo) {
    const query = await promptText('Search GitHub repositories:');
    if (!query) {
      throw new CliError('Search query is required.');
    }

    const results = await withSpinner(
      'Searching GitHub...',
      () => searchGitHubRepos(query, token, 8),
      logger.verbosity === 'quiet',
    );

    if (results.items.length === 0) {
      logger.info(`No repositories found for "${query}". Try a different search.`);
      continue;
    }

    logger.info(`Found ${results.items.length} results (of ${results.totalCount} total):`);

    const choices = results.items.map((r) => ({
      value: r.fullName,
      label: `${r.fullName}${r.private ? ' \u{1F512}' : ''}${r.description ? ` \u2014 ${r.description}` : ''}`,
    }));
    choices.push({ value: '__search_again__', label: '\u21BB Search again' });

    const selected = await promptChoice('Select repository:', choices, choices[0].value);
    if (selected === '__search_again__') {
      continue;
    }

    repo = selected;
    defaultBranch =
      results.items.find((r) => r.fullName === selected)?.defaultBranch ?? 'main';
  }

  return { repo, defaultBranch };
}

/**
 * Interactive flow to create a new GitHub repository for the business canon.
 */
async function createNewBusinessCanonRepo(
  token: string,
  logger: Logger,
): Promise<{ fullName: string; defaultBranch: string }> {
  // Resolve owner: user account + orgs
  const [username, orgs] = await Promise.all([
    withSpinner('Fetching GitHub account info...', () => getAuthenticatedUser(token), logger.verbosity === 'quiet'),
    withSpinner('Fetching organizations...', () => listUserOrgs(token), logger.verbosity === 'quiet'),
  ]);

  let owner: string;
  if (orgs.length === 0) {
    owner = username;
    logger.info(`Owner: ${username}`);
  } else {
    const ownerChoices = [
      { value: username, label: `${username} (personal account)` },
      ...orgs.map((org) => ({ value: org, label: org })),
    ];
    owner = await promptChoice('Repository owner:', ownerChoices, username);
  }

  // Prompt for repo name
  const repoName = await promptText('Repository name:');
  if (!repoName) {
    throw new CliError('Repository name is required.');
  }

  // Validate repo name (basic GitHub name rules)
  if (!/^[a-zA-Z0-9._-]+$/.test(repoName)) {
    throw new CliError(
      `Invalid repository name "${repoName}". Use only letters, numbers, hyphens, dots, and underscores.`,
    );
  }

  // Visibility
  const visibility = await promptChoice(
    'Visibility:',
    [
      { value: 'private', label: 'Private' },
      { value: 'public', label: 'Public' },
    ],
    'private',
  );

  // Optional description
  const description = await promptText('Description (optional):');

  // Create the repository
  const result = await withSpinner(
    `Creating ${owner}/${repoName}...`,
    () => createGitHubRepo(
      {
        name: repoName,
        description: description || undefined,
        isPrivate: visibility === 'private',
        org: owner === username ? undefined : owner,
      },
      token,
    ),
    logger.verbosity === 'quiet',
  );

  logger.info(`Repository created: ${result.fullName}${result.private ? ' \u{1F512}' : ''}`);

  return {
    fullName: result.fullName,
    defaultBranch: result.defaultBranch,
  };
}

/**
 * Clones a GitHub repo into the workspace directory with a visible spinner.
 * Skips if the target directory already exists.
 */
export async function cloneGitHubRepo(
  slug: string,
  branch: string,
  workspaceDir: string,
  token: string,
  logger: Logger,
): Promise<void> {
  const repoName = slug.split('/').pop() ?? slug;
  const targetDir = path.join(workspaceDir, repoName);

  if (fs.existsSync(targetDir)) {
    logger.info(`Directory "${repoName}" already exists, skipping clone.`);
    return;
  }

  const cloneUrl = `https://x-access-token:${token}@github.com/${slug}.git`;

  await withSpinner(
    `Cloning ${slug}...`,
    () => new Promise<void>((resolve, reject) => {
      const child = spawn(
        'git',
        ['clone', '--branch', branch, '--single-branch', '--progress', cloneUrl, repoName],
        { cwd: workspaceDir, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on('close', (code) => {
        if (code !== 0) {
          const sanitized = stderr.replace(/x-access-token:[^@]+@/g, 'x-access-token:***@');
          reject(new Error(sanitized.trim() || `git clone exited with code ${code}`));
        } else {
          resolve();
        }
      });
      child.on('error', reject);
    }),
    logger.verbosity === 'quiet',
  );

  // Replace token-embedded remote with clean HTTPS URL so the token
  // does not persist in .git/config.
  const cleanUrl = `https://github.com/${slug}.git`;
  try {
    execFileSync('git', ['-C', targetDir, 'remote', 'set-url', 'origin', cleanUrl], {
      stdio: 'ignore',
    });
  } catch {
    // Non-fatal — clone succeeded, remote cleanup is best-effort
  }
}

export async function ensureGitHubAuth(collabDir: string, logger: Logger): Promise<string> {
  const existing = loadGitHubAuth(collabDir);
  if (existing) {
    const valid = await isGitHubAuthValid(existing);
    if (valid) {
      return existing.token;
    }
    logger.info('Existing GitHub token expired. Re-authorizing...');
  }

  await runGitHubDeviceFlow(collabDir, (msg) => logger.info(msg));
  const auth = loadGitHubAuth(collabDir);
  if (!auth) {
    throw new CliError('GitHub authorization failed.');
  }
  return auth.token;
}
