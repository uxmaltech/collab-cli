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

import { cloneGitHubRepo, ensureGitHubAuth } from './business-canon';
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
  /** Directory name to exclude from governed repos (e.g. business canon). */
  excludeRepo?: string,
): Promise<WorkspaceResolution | null> {
  const name = deriveWorkspaceName(workspaceDir);
  const isIndexed = mode === 'indexed';

  /** Filter out the business canon from a repo list. */
  const filterRepos = (repos: string[]): string[] =>
    excludeRepo ? repos.filter((r) => r !== excludeRepo) : repos;

  // Explicit --repos flag takes priority
  const explicit = parseRepos(options.repos);
  if (explicit && explicit.length > 0) {
    const filtered = filterRepos(explicit);
    // In indexed mode, always force multi-repo type
    const type = isIndexed || filtered.length >= 2 ? 'multi-repo' : 'mono-repo';
    logger.info(`Workspace mode: ${filtered.length} repo(s) specified: ${filtered.join(', ')}`);
    return { name, type, repos: filtered };
  }

  // Auto-detect workspace layout
  const layout = detectWorkspaceLayout(workspaceDir);

  if (layout) {
    // True mono-repo (cwd IS a git repo, repos=['.']) — always reject in indexed mode.
    const isCwdRepo = layout.repos.length === 1 && layout.repos[0] === '.';
    if (isIndexed && isCwdRepo) {
      throw new CliError(
        'Indexed mode requires a multi-repo workspace (business-canon + at least 1 governed repo).\n' +
          'Current directory is detected as mono-repo. ' +
          'Run from a parent directory containing multiple git repositories.',
      );
    }

    // Apply business canon filter to discovered repos
    const governedRepos = filterRepos(layout.repos);

    // Indexed mode + no governed repos after filtering: need more repos.
    if (isIndexed && governedRepos.length === 0) {
      if (options.yes) {
        throw new CliError(
          'Indexed mode requires a multi-repo workspace (business-canon + at least 1 governed repo).\n' +
            'No governed repositories found in the workspace directory.\n' +
            'Clone additional repos from GitHub and re-run, or pass --repos repo1,repo2.',
        );
      }

      // Interactive: business canon is the only repo — let user clone governed repos
      if (excludeRepo) {
        logger.info(
          `Found business canon "${excludeRepo}" in workspace. ` +
            'Indexed mode requires additional governed repos.',
        );
      }
      const cloned = await searchAndCloneRepos(workspaceDir, collabDir, logger);
      if (cloned.length === 0) return null;
      return { name, type: 'multi-repo', repos: cloned };
    }

    // Indexed mode + only 1 governed repo after filtering: need more.
    if (isIndexed && governedRepos.length === 1 && !isCwdRepo) {
      if (options.yes) {
        throw new CliError(
          'Indexed mode requires a multi-repo workspace (business-canon + at least 1 governed repo).\n' +
            'Only one governed repository found in the workspace directory.\n' +
            'Clone additional repos from GitHub and re-run, or pass --repos repo1,repo2.',
        );
      }

      logger.info(
        `Found ${governedRepos.join(', ')} in workspace. ` +
          'Indexed mode requires additional governed repos.',
      );
      const cloned = await searchAndCloneRepos(workspaceDir, collabDir, logger);
      const allRepos = [...new Set([...governedRepos, ...cloned])].sort();
      if (allRepos.length < 2) return null;
      return { name, type: 'multi-repo', repos: allRepos };
    }

    if (options.yes) {
      logger.info(
        `Workspace auto-detected (${layout.type}): ${governedRepos.length} repo(s) found: ${governedRepos.join(', ')}`,
      );
      const type = isIndexed || governedRepos.length >= 2 ? 'multi-repo' : layout.type;
      return { name, type, repos: governedRepos };
    }

    // Interactive: for multi-repo let user confirm/select repos
    if (governedRepos.length >= 2) {
      const selected = await promptMultiSelect(
        'Select governed repositories to include:',
        governedRepos.map((r) => ({ value: r, label: r })),
        governedRepos,
      );

      if (selected.length === 0) return null;
      return { name, type: 'multi-repo', repos: selected };
    }

    // mono-repo auto-detected (file-only only — indexed handled above)
    if (governedRepos.length === 1) {
      logger.info(`Mono-repo workspace detected: ${governedRepos.join(', ')}`);
      return { name, type: 'mono-repo', repos: governedRepos };
    }
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
    choices.push({ value: '__search_again__', label: '\u21BB Search again' });

    const picked = await promptMultiSelect(
      'Select repositories to clone:',
      choices,
      [],
    );

    // Handle "Search again" sentinel or empty selection → re-search
    if (picked.length === 0 || picked.includes('__search_again__')) {
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

  // Clone selected repos using the shared helper
  logger.info(`Cloning ${selected.length} repo(s) into ${workspaceDir}...`);
  const cloned: string[] = [];

  for (const repo of selected) {
    const repoName = repo.fullName.split('/')[1];

    if (fs.existsSync(path.join(workspaceDir, repoName))) {
      logger.info(`Directory "${repoName}" already exists, skipping clone.`);
      cloned.push(repoName);
      continue;
    }

    try {
      await cloneGitHubRepo(repo.fullName, repo.defaultBranch, workspaceDir, token, logger);
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
