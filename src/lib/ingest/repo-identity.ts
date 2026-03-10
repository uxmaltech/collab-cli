import { execFileSync } from 'node:child_process';

export interface RepoIdentity {
  organization: string;
  repo: string;
  scope: string;
}

export function resolveRepoIdentity(repoDir: string, fallbackScope: string): RepoIdentity {
  try {
    const remoteUrl = execFileSync(
      'git',
      ['-C', repoDir, 'remote', 'get-url', 'origin'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();

    const normalized = remoteUrl.trim().replace(/\/+$/, '').replace(/\.git$/, '');
    const match =
      normalized.match(/^https?:\/\/[^/]+\/(.+)$/i) ??
      normalized.match(/^ssh:\/\/[^/]+\/(.+)$/i) ??
      normalized.match(/^[^@]+@[^:]+:(.+)$/i);

    const segments = match?.[1].split('/').filter(Boolean) ?? [];
    const organization = segments.at(-2);
    const repoName = segments.at(-1);
    if (organization && repoName) {
      return {
        organization,
        repo: `${organization}/${repoName}`,
        scope: repoName,
      };
    }
  } catch {
    // Fallback below
  }

  const scope = fallbackScope.split('/').filter(Boolean).pop() || 'repo';
  return {
    organization: 'local',
    repo: `local/${scope}`,
    scope,
  };
}
