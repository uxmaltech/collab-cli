import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

import type { CanonsConfig, CollabConfig } from '../../lib/config';
import { CliError } from '../../lib/errors';
import { searchGitHubRepos } from '../../lib/github-search';
import { loadGitHubAuth, isGitHubAuthValid, runGitHubDeviceFlow } from '../../lib/github-auth';
import type { CollabMode } from '../../lib/mode';
import type { Logger } from '../../lib/logger';
import { promptChoice, promptText } from '../../lib/prompt';
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

  // Search loop
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
      label: `${r.fullName}${r.private ? ' \u{1F512}' : ''}${r.description ? ` — ${r.description}` : ''}`,
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

  const branch = await promptText('Branch:', defaultBranch);

  return {
    business: {
      repo,
      branch: branch || defaultBranch,
      localDir: 'business',
      source: 'github',
    },
  };
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
