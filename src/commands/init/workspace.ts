import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  deriveWorkspaceName,
  detectWorkspaceLayout,
} from '../../lib/config';
import { CliError } from '../../lib/errors';
import { searchGitHubRepos } from '../../lib/github-search';
import type { CollabMode } from '../../lib/mode';
import type { Logger } from '../../lib/logger';
import { promptChoice, promptMultiSelect, promptText } from '../../lib/prompt';
import { withSpinner } from '../../lib/spinner';

import { ensureGitHubAuth } from './business-canon';
import type { InitOptions, WorkspaceResolution } from './types';

function parseRepos(value: string | undefined): string[] | null {
  if (!value) return null;
  return value.split(',').map((r) => r.trim()).filter(Boolean);
}

export async function resolveWorkspace(
  workspaceDir: string,
  collabDir: string,
  options: InitOptions,
  logger: Logger,
  mode: CollabMode = 'file-only',
): Promise<WorkspaceResolution | null> {
  const name = deriveWorkspaceName(workspaceDir);
  const isIndexed = mode === 'indexed';

  // Explicit --repos flag takes priority
  const explicit = parseRepos(options.repos);
  if (explicit && explicit.length > 0) {
    // In indexed mode, always force multi-repo type
    const type = isIndexed || explicit.length >= 2 ? 'multi-repo' : 'mono-repo';
    logger.info(`Workspace mode: ${explicit.length} repo(s) specified: ${explicit.join(', ')}`);
    return { name, type, repos: explicit };
  }

  // Auto-detect workspace layout
  const layout = detectWorkspaceLayout(workspaceDir);

  if (layout) {
    // Indexed mode: reject mono-repo
    if (isIndexed && layout.type === 'mono-repo') {
      throw new CliError(
        'Indexed mode requires a multi-repo workspace (business-canon + at least 1 governed repo).\n' +
          'Current directory is detected as mono-repo. ' +
          'Run from a parent directory containing multiple git repositories.',
      );
    }

    if (options.yes) {
      logger.info(
        `Workspace auto-detected (${layout.type}): ${layout.repos.length} repo(s) found: ${layout.repos.join(', ')}`,
      );
      return { name, type: layout.type, repos: layout.repos };
    }

    // Interactive: for multi-repo let user confirm/select repos
    if (layout.type === 'multi-repo') {
      const selected = await promptMultiSelect(
        'This directory contains multiple git repositories. Select repos to include:',
        layout.repos.map((r) => ({ value: r, label: r })),
        layout.repos,
      );

      if (selected.length === 0) return null;
      return { name, type: 'multi-repo', repos: selected };
    }

    // mono-repo auto-detected (file-only only — indexed rejected above)
    logger.info(`Mono-repo workspace detected: ${layout.repos.join(', ')}`);
    return { name, type: 'mono-repo', repos: layout.repos };
  }

  // No repos found
  if (isIndexed) {
    if (options.yes) {
      throw new CliError(
        'Indexed mode requires a multi-repo workspace with at least 1 governed repo.\n' +
          'No git repositories found in the workspace directory.\n' +
          'Clone your repos from GitHub and re-run, or pass --repos repo1,repo2.',
      );
    }

    // Interactive: let user search and clone repos from GitHub
    logger.info('No repositories found in the workspace. Search GitHub to select and clone repos.');
    const cloned = await searchAndCloneRepos(workspaceDir, collabDir, logger);
    if (cloned.length === 0) return null;
    return { name, type: 'multi-repo', repos: cloned };
  }

  if (options.yes) {
    // Non-interactive with no repos → treat cwd as mono-repo
    logger.info('No repos discovered; initializing as mono-repo workspace.');
    return { name, type: 'mono-repo', repos: ['.'] };
  }

  return null;
}

/**
 * Interactive GitHub search → multi-select → clone flow.
 * Used when indexed mode has no repos in the workspace.
 * Returns the list of cloned repo directory names.
 */
async function searchAndCloneRepos(
  workspaceDir: string,
  collabDir: string,
  logger: Logger,
): Promise<string[]> {
  const token = await ensureGitHubAuth(collabDir, logger);

  const selected: { fullName: string; defaultBranch: string }[] = [];

  // Search loop: let user search and accumulate repos
  let done = false;
  while (!done) {
    const query = await promptText('Search GitHub repositories to clone:');
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

    const picked = await promptMultiSelect(
      'Select repositories to clone:',
      choices,
      [],
    );

    if (picked.length === 0 && selected.length === 0) {
      const retry = await promptChoice(
        'No repositories selected. Search again?',
        [
          { value: 'yes', label: 'Yes, search again' },
          { value: 'no', label: 'No, cancel' },
        ],
        'yes',
      );
      if (retry === 'no') return [];
      continue;
    }

    for (const fullName of picked) {
      if (!selected.some((s) => s.fullName === fullName)) {
        const match = results.items.find((r) => r.fullName === fullName);
        selected.push({
          fullName,
          defaultBranch: match?.defaultBranch ?? 'main',
        });
      }
    }

    if (selected.length > 0) {
      logger.info(`Selected so far: ${selected.map((s) => s.fullName).join(', ')}`);
      const more = await promptChoice(
        'Add more repositories?',
        [
          { value: 'no', label: 'No, continue with selected repos' },
          { value: 'yes', label: 'Yes, search for more' },
        ],
        'no',
      );
      done = more === 'no';
    }
  }

  if (selected.length === 0) {
    return [];
  }

  // Clone selected repos into workspace
  logger.info(`Cloning ${selected.length} repo(s) into ${workspaceDir}...`);
  const cloned: string[] = [];

  for (const repo of selected) {
    const repoName = repo.fullName.split('/')[1];
    const targetDir = path.join(workspaceDir, repoName);

    if (fs.existsSync(targetDir)) {
      logger.info(`Directory "${repoName}" already exists, skipping clone.`);
      cloned.push(repoName);
      continue;
    }

    const cloneUrl = `https://x-access-token:${token}@github.com/${repo.fullName}.git`;

    try {
      await withSpinner(
        `Cloning ${repo.fullName}...`,
        () => new Promise<void>((resolve, reject) => {
          const child = spawn('git', ['clone', cloneUrl, repoName], {
            cwd: workspaceDir,
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          let stderr = '';
          child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
          child.on('close', (code) => {
            if (code !== 0) {
              reject(new Error(stderr.trim() || 'unknown error'));
            } else {
              resolve();
            }
          });
          child.on('error', reject);
        }),
        logger.verbosity === 'quiet',
      );
      cloned.push(repoName);
    } catch (error) {
      logger.warn(error instanceof Error ? error.message : String(error));
      continue;
    }
  }

  if (cloned.length === 0) {
    throw new CliError('No repositories were cloned successfully.');
  }

  return cloned;
}
