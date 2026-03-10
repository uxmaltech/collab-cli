import { CliError } from './errors';

const GITHUB_API_VERSION = '2022-11-28';
const SEARCH_TIMEOUT_MS = 15_000;

export interface GitHubRepoResult {
  fullName: string;
  description: string;
  private: boolean;
  defaultBranch: string;
}

export interface GitHubSearchResponse {
  totalCount: number;
  items: GitHubRepoResult[];
}

/**
 * Searches GitHub repositories using the REST search API.
 * Requires a valid GitHub token with `repo` scope for private repos.
 *
 * @param query  - Search query (same syntax as GitHub web search)
 * @param token  - GitHub personal access token or OAuth token
 * @param limit  - Max results to return (default 8, max 100)
 */
export async function searchGitHubRepos(
  query: string,
  token: string,
  limit = 8,
): Promise<GitHubSearchResponse> {
  const encoded = encodeURIComponent(query);
  const url = `https://api.github.com/search/repositories?q=${encoded}&per_page=${limit}&sort=updated`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

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
      const body = await response.text().catch(() => '');
      throw new CliError(
        `GitHub search failed (HTTP ${response.status}): ${body || response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      total_count: number;
      items: Array<{
        full_name: string;
        description: string | null;
        private: boolean;
        default_branch: string;
      }>;
    };

    return {
      totalCount: data.total_count,
      items: data.items.map((item) => ({
        fullName: item.full_name,
        description: item.description ?? '',
        private: item.private,
        defaultBranch: item.default_branch,
      })),
    };
  } catch (error: unknown) {
    if (error instanceof CliError) {
      throw error;
    }

    // AbortController fires when the timeout elapses — surface a clear message
    if (error instanceof Error && error.name === 'AbortError') {
      throw new CliError(`GitHub search request timed out after ${SEARCH_TIMEOUT_MS / 1000}s.`);
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(`GitHub search request failed: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parses the `Link` header from a GitHub API response to extract the "next" page URL.
 * Returns `null` if there is no next page.
 */
function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;

  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }

  return null;
}

/**
 * Lists branches for a GitHub repository.
 * Paginates through all pages (per_page=100) and returns branch names
 * sorted alphabetically, with the default branch first.
 */
export async function listGitHubBranches(
  slug: string,
  token: string,
  defaultBranch?: string,
): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  };

  try {
    const allNames: string[] = [];
    let nextUrl: string | null = `https://api.github.com/repos/${slug}/branches?per_page=100`;

    while (nextUrl) {
      const response = await fetch(nextUrl, { headers, signal: controller.signal });

      if (!response.ok) {
        // On first page failure, fall back; on later pages, return what we have
        if (allNames.length === 0) {
          return defaultBranch ? [defaultBranch] : ['main'];
        }
        break;
      }

      const data = (await response.json()) as Array<{ name: string }>;
      for (const b of data) {
        allNames.push(b.name);
      }

      nextUrl = parseNextLink(response.headers.get('link'));
    }

    const names = allNames.sort();

    // Move default branch to the front if present
    if (defaultBranch && names.includes(defaultBranch)) {
      return [defaultBranch, ...names.filter((n) => n !== defaultBranch)];
    }

    return names;
  } catch {
    // Graceful fallback — don't block init if branch listing fails
    return defaultBranch ? [defaultBranch] : ['main'];
  } finally {
    clearTimeout(timer);
  }
}
