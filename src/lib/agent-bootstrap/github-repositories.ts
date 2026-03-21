import { CliError } from '../errors';
import { normalizeGitHubRemote } from '../github-api';
import { loadGitHubAuth, isGitHubAuthValid, runGitHubDeviceFlow } from '../github-auth';
import { type Logger } from '../logger';
import { searchGitHubRepos } from '../github-search';
import { withSpinner } from '../spinner';
import type { BirthPromptAdapter } from './wizard';

export interface BirthRepositorySelection {
  selfRepository: string;
  assignedRepositories: string[];
}

export interface GitHubBirthRepositoryPickerOptions {
  collabDir: string;
  logger: Logger;
  prompt: BirthPromptAdapter;
}

function normalizeRepositorySlug(value: string): string | null {
  const trimmed = value.trim().replace(/[),.;]+$/g, '');

  if (!trimmed) {
    return null;
  }

  const normalizedRemote = normalizeGitHubRemote(trimmed);
  if (normalizedRemote) {
    return normalizedRemote;
  }

  const slugMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!slugMatch) {
    return null;
  }

  if (slugMatch[1].toLowerCase() === 'github.com') {
    return null;
  }

  return `${slugMatch[1]}/${slugMatch[2]}`;
}

export function extractGitHubRepositoryReferences(text: string): string[] {
  const matches = new Set<string>();
  const urlPattern = /https?:\/\/github\.com\/[^\s)]+/gi;
  const slugPattern = /\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\b/g;

  for (const match of text.match(urlPattern) ?? []) {
    const normalized = normalizeRepositorySlug(match);
    if (normalized) {
      matches.add(normalized);
    }
  }

  for (const match of text.match(slugPattern) ?? []) {
    const normalized = normalizeRepositorySlug(match);
    if (normalized) {
      matches.add(normalized);
    }
  }

  return [...matches];
}

async function validateGitHubRepositorySlug(
  slug: string,
  token: string | undefined,
): Promise<boolean> {
  try {
    const response = await fetch(`https://api.github.com/repos/${slug}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (token && response.status === 401) {
      return validateGitHubRepositorySlug(slug, undefined);
    }

    return response.ok;
  } catch {
    return false;
  }
}

export async function validateGitHubRepositoryReferences(
  slugs: readonly string[],
  collabDir: string,
): Promise<string[]> {
  if (slugs.length === 0) {
    return [];
  }

  const token = loadGitHubAuth(collabDir)?.token;
  const results = await Promise.all(
    [...new Set(slugs)].map(async (slug) => ({
      slug,
      valid: await validateGitHubRepositorySlug(slug, token),
    })),
  );

  return results.filter((entry) => entry.valid).map((entry) => entry.slug);
}

async function ensureGitHubAuthForBirth(collabDir: string, logger: Logger): Promise<string> {
  const existing = loadGitHubAuth(collabDir);
  if (existing) {
    const valid = await isGitHubAuthValid(existing);
    if (valid) {
      return existing.token;
    }
    logger.info('Existing GitHub token expired. Re-authorizing...');
  }

  await runGitHubDeviceFlow(collabDir, (message) => logger.info(message));
  const auth = loadGitHubAuth(collabDir);

  if (!auth) {
    throw new CliError('GitHub authorization failed.');
  }

  return auth.token;
}

function formatRepoChoiceLabel(
  repository: { fullName: string; description: string; private: boolean },
): string {
  const lock = repository.private ? ' \u{1F512}' : '';
  const description = repository.description ? ` \u2014 ${repository.description}` : '';
  return `${repository.fullName}${lock}${description}`;
}

async function searchAndSelectSingleRepository(
  token: string,
  logger: Logger,
  prompt: BirthPromptAdapter,
  question: string,
  searchQuestion: string,
  initialQuery: string | undefined,
  exclude: readonly string[] = [],
): Promise<string> {
  let defaultQuery = initialQuery;

  while (true) {
    const query = await prompt.text(searchQuestion, defaultQuery);
    if (!query.trim()) {
      throw new CliError('GitHub search query is required.');
    }

    const results = await withSpinner(
      'Searching GitHub...',
      () => searchGitHubRepos(query, token, 8),
      logger.verbosity === 'quiet',
    );

    const filtered = results.items.filter((item) => !exclude.includes(item.fullName));

    if (filtered.length === 0) {
      logger.info(`No repositories found for "${query}". Try a different search.`);
      defaultQuery = query;
      continue;
    }

    const choices = filtered.map((item) => ({
      value: item.fullName,
      label: formatRepoChoiceLabel(item),
    }));
    choices.push({ value: '__search_again__', label: '\u21BB Search again' });

    const selected = await prompt.choice(question, choices, choices[0].value);
    if (selected === '__search_again__') {
      defaultQuery = query;
      continue;
    }

    return selected;
  }
}

async function searchAndSelectAssignedRepositories(
  token: string,
  logger: Logger,
  prompt: BirthPromptAdapter,
  selfRepository: string,
  initialAssigned: readonly string[] = [],
): Promise<string[]> {
  const selected = [...new Set(initialAssigned.filter((repo) => repo !== selfRepository))];

  if (selected.length === 0) {
    const shouldAssign = await prompt.choice(
      'Assign additional repositories from GitHub?',
      [
        { value: 'no', label: 'No, only the self repository for now' },
        { value: 'yes', label: 'Yes, select assigned repositories' },
      ],
      'no',
    );

    if (shouldAssign === 'no') {
      return [];
    }
  }

  let continueSelection = true;
  let defaultQuery = selfRepository.split('/')[0];

  while (continueSelection) {
    const query = await prompt.text(
      'Search GitHub repositories for assigned work',
      defaultQuery,
    );
    if (!query.trim()) {
      throw new CliError('GitHub search query is required.');
    }

    const results = await withSpinner(
      'Searching GitHub...',
      () => searchGitHubRepos(query, token, 8),
      logger.verbosity === 'quiet',
    );

    const filtered = results.items.filter(
      (item) => item.fullName !== selfRepository && !selected.includes(item.fullName),
    );

    if (filtered.length === 0) {
      logger.info(`No repositories found for "${query}". Try a different search.`);
      defaultQuery = query;
      continue;
    }

    const choices = filtered.map((item) => ({
      value: item.fullName,
      label: formatRepoChoiceLabel(item),
    }));
    choices.push({ value: '__search_again__', label: '\u21BB Search again' });

    const picked = await prompt.multiSelect(
      'Select assigned repositories',
      choices,
      [],
    );

    if (picked.length === 0 || picked.includes('__search_again__')) {
      defaultQuery = query;
      continue;
    }

    for (const repo of picked) {
      if (repo !== '__search_again__' && !selected.includes(repo)) {
        selected.push(repo);
      }
    }

    logger.info(`Assigned so far: ${selected.join(', ')}`);
    const more = await prompt.choice(
      'Add more assigned repositories?',
      [
        { value: 'no', label: 'No, continue with these repositories' },
        { value: 'yes', label: 'Yes, search for more' },
      ],
      'no',
    );

    continueSelection = more === 'yes';
    defaultQuery = query;
  }

  return selected;
}

export async function pickBirthRepositoriesFromGitHub(
  options: GitHubBirthRepositoryPickerOptions,
): Promise<BirthRepositorySelection> {
  const token = await ensureGitHubAuthForBirth(options.collabDir, options.logger);
  const selfRepository = await searchAndSelectSingleRepository(
    token,
    options.logger,
    options.prompt,
    'Select self repository',
    'Search GitHub repositories for the agent self repository',
    undefined,
  );

  const assignedRepositories = await searchAndSelectAssignedRepositories(
    token,
    options.logger,
    options.prompt,
    selfRepository,
  );

  return {
    selfRepository,
    assignedRepositories,
  };
}
