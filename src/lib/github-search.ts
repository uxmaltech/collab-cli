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
