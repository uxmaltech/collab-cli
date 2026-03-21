import { createPrivateKey, createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { CliError } from '../errors';

const GITHUB_API_BASE_URL = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const GITHUB_ACCEPT_HEADER = 'application/vnd.github+json';
const GITHUB_USER_AGENT = 'collab-cli/0.1.10';
const GITHUB_REQUEST_TIMEOUT_MS = 10_000;
const GITHUB_JWT_CLOCK_SKEW_SECONDS = 60;
const GITHUB_JWT_TTL_SECONDS = 9 * 60;

export type GitHubAppOwnerType = 'auto' | 'org' | 'user';
export type GitHubAppPromptField =
  | 'githubAppId'
  | 'githubAppInstallationId'
  | 'githubAppPrivateKeyPath';

export interface ValidateGitHubAppIdentityInput {
  appId: string;
  installationId: string;
  owner?: string;
  ownerType?: GitHubAppOwnerType;
  privateKeyPath: string;
  repositories?: readonly string[];
  cwd?: string;
}

export interface ValidateGitHubAppIdentityResult {
  appId: string;
  installationId: string;
  owner: string;
  ownerType: 'org' | 'user';
  privateKeyPath: string;
  validatedRepositories: string[];
}

interface GitHubAppInfoResponse {
  id?: number | string;
  slug?: string;
}

interface GitHubInstallationResponse {
  id?: number | string;
  account?: {
    login?: string;
    type?: string;
  };
}

interface GitHubInstallationTokenResponse {
  token?: string;
}

export class GitHubAppValidationError extends CliError {
  constructor(
    message: string,
    public readonly code: string,
    public readonly promptFields: GitHubAppPromptField[],
  ) {
    super(message);
    this.name = 'GitHubAppValidationError';
  }
}

function buildBase64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function normalizePrivateKeyPem(value: string): string {
  return value.replace(/\\n/g, '\n');
}

function encodeGitHubAppJwt(appId: string, privateKeyPem: string, now: Date): string {
  const issuedAtSeconds =
    Math.floor(now.getTime() / 1000) - GITHUB_JWT_CLOCK_SKEW_SECONDS;
  const header = buildBase64UrlJson({
    alg: 'RS256',
    typ: 'JWT',
  });
  const payload = buildBase64UrlJson({
    iat: issuedAtSeconds,
    exp: issuedAtSeconds + GITHUB_JWT_TTL_SECONDS,
    iss: appId,
  });
  const signingInput = `${header}.${payload}`;
  const privateKey = createPrivateKey(privateKeyPem);
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .end()
    .sign(privateKey)
    .toString('base64url');

  return `${signingInput}.${signature}`;
}

function resolvePrivateKeyPath(privateKeyPath: string, cwd: string): string {
  return path.isAbsolute(privateKeyPath)
    ? privateKeyPath
    : path.resolve(cwd, privateKeyPath);
}

function mapOwnerType(value: string | undefined): 'org' | 'user' {
  if (value === 'Organization') {
    return 'org';
  }

  if (value === 'User') {
    return 'user';
  }

  throw new GitHubAppValidationError(
    `GitHub App installation returned an unsupported owner type '${value ?? 'unknown'}'.`,
    'unsupported_owner_type',
    ['githubAppInstallationId'],
  );
}

async function githubRequest<T>(
  pathname: string,
  options: {
    method?: 'GET' | 'POST';
    bearerToken: string;
    body?: Record<string, unknown>;
  },
): Promise<{ response: Response; json?: T; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GITHUB_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(new URL(pathname, `${GITHUB_API_BASE_URL}/`), {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${options.bearerToken}`,
        Accept: GITHUB_ACCEPT_HEADER,
        'Content-Type': 'application/json',
        'User-Agent': GITHUB_USER_AGENT,
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let json: T | undefined;
    if (text.length > 0) {
      try {
        json = JSON.parse(text) as T;
      } catch {
        json = undefined;
      }
    }
    return {
      response,
      json,
      text,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new GitHubAppValidationError(
      `GitHub validation failed: ${message}`,
      'github_request_failed',
      ['githubAppId', 'githubAppInstallationId', 'githubAppPrivateKeyPath'],
    );
  } finally {
    clearTimeout(timer);
  }
}

function normalizeRepositoryList(repositories: readonly string[] | undefined): string[] {
  return [...new Set((repositories ?? []).map((value) => value.trim()).filter((value) => value.length > 0))];
}

export async function validateGitHubAppIdentity(
  input: ValidateGitHubAppIdentityInput,
): Promise<ValidateGitHubAppIdentityResult> {
  const appId = input.appId.trim();
  if (appId.length === 0) {
    throw new GitHubAppValidationError(
      'GitHub App id is required.',
      'missing_app_id',
      ['githubAppId'],
    );
  }

  const installationId = input.installationId.trim();
  if (installationId.length === 0) {
    throw new GitHubAppValidationError(
      'GitHub App installation id is required.',
      'missing_installation_id',
      ['githubAppInstallationId'],
    );
  }

  const privateKeyPathInput = input.privateKeyPath.trim();
  if (privateKeyPathInput.length === 0) {
    throw new GitHubAppValidationError(
      'GitHub App private key path is required so the wizard can validate the GitHub App identity.',
      'missing_private_key_path',
      ['githubAppPrivateKeyPath'],
    );
  }

  const resolvedPrivateKeyPath = resolvePrivateKeyPath(
    privateKeyPathInput,
    input.cwd ?? process.cwd(),
  );

  let privateKeyPem: string;
  try {
    privateKeyPem = normalizePrivateKeyPem(await readFile(resolvedPrivateKeyPath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new GitHubAppValidationError(
      `GitHub App private key path is unreadable: ${message}`,
      'private_key_unreadable',
      ['githubAppPrivateKeyPath'],
    );
  }

  let appJwt: string;
  try {
    appJwt = encodeGitHubAppJwt(appId, privateKeyPem, new Date());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new GitHubAppValidationError(
      `GitHub App private key is invalid: ${message}`,
      'private_key_invalid',
      ['githubAppPrivateKeyPath'],
    );
  }

  const appResponse = await githubRequest<GitHubAppInfoResponse>('/app', {
    bearerToken: appJwt,
  });
  if (!appResponse.response.ok) {
    throw new GitHubAppValidationError(
      appResponse.response.status === 401 || appResponse.response.status === 403
        ? 'GitHub rejected the App id/private key combination. Re-check the App id and private key path.'
        : `GitHub App validation failed with status ${appResponse.response.status}.`,
      'app_auth_failed',
      ['githubAppId', 'githubAppPrivateKeyPath'],
    );
  }

  const githubAppInfo = appResponse.json;
  if (!githubAppInfo) {
    throw new GitHubAppValidationError(
      'GitHub App validation returned an unreadable response body.',
      'app_response_invalid',
      ['githubAppId', 'githubAppPrivateKeyPath'],
    );
  }
  const remoteAppId = String(githubAppInfo.id ?? '');
  if (remoteAppId.length > 0 && remoteAppId !== appId) {
    throw new GitHubAppValidationError(
      `GitHub authenticated a different App id (${remoteAppId}) than the one provided (${appId}).`,
      'app_id_mismatch',
      ['githubAppId', 'githubAppPrivateKeyPath'],
    );
  }

  const installationResponse = await githubRequest<GitHubInstallationResponse>(
    `/app/installations/${encodeURIComponent(installationId)}`,
    {
      bearerToken: appJwt,
    },
  );
  if (installationResponse.response.status === 404) {
    throw new GitHubAppValidationError(
      `GitHub App installation ${installationId} was not found for App ${appId}.`,
      'installation_not_found',
      ['githubAppInstallationId'],
    );
  }
  if (!installationResponse.response.ok) {
    throw new GitHubAppValidationError(
      installationResponse.response.status === 401 || installationResponse.response.status === 403
        ? 'GitHub rejected the App credentials while resolving the installation. Re-check the App id, installation id, and private key path.'
        : `GitHub installation validation failed with status ${installationResponse.response.status}.`,
      'installation_lookup_failed',
      ['githubAppId', 'githubAppInstallationId', 'githubAppPrivateKeyPath'],
    );
  }

  const installation = installationResponse.json;
  if (!installation) {
    throw new GitHubAppValidationError(
      `GitHub App installation ${installationId} returned an unreadable response body.`,
      'installation_response_invalid',
      ['githubAppInstallationId'],
    );
  }
  const installationOwner = installation.account?.login?.trim();
  if (!installationOwner) {
    throw new GitHubAppValidationError(
      `GitHub App installation ${installationId} did not return an owner login.`,
      'installation_owner_missing',
      ['githubAppInstallationId'],
    );
  }
  const installationOwnerType = mapOwnerType(installation.account?.type);
  const expectedOwner = input.owner?.trim();
  if (
    expectedOwner
    && installationOwner.localeCompare(expectedOwner, undefined, { sensitivity: 'accent' }) !== 0
  ) {
    throw new GitHubAppValidationError(
      `GitHub App installation ${installationId} belongs to '${installationOwner}', but the born agent is scoped to '${expectedOwner}'. Choose an installation for '${expectedOwner}'.`,
      'installation_owner_mismatch',
      ['githubAppInstallationId'],
    );
  }

  const requestedOwnerType = input.ownerType ?? 'auto';
  if (requestedOwnerType !== 'auto' && requestedOwnerType !== installationOwnerType) {
    throw new GitHubAppValidationError(
      `GitHub App installation ${installationId} is a '${installationOwnerType}' installation, not '${requestedOwnerType}'.`,
      'installation_owner_type_mismatch',
      ['githubAppInstallationId'],
    );
  }

  const accessTokenResponse = await githubRequest<GitHubInstallationTokenResponse>(
    `/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    {
      method: 'POST',
      bearerToken: appJwt,
      body: {},
    },
  );
  if (!accessTokenResponse.response.ok) {
    throw new GitHubAppValidationError(
      accessTokenResponse.response.status === 401 || accessTokenResponse.response.status === 403
        ? 'GitHub rejected the App credentials while creating an installation token. Re-check the App id, installation id, and private key path.'
        : `GitHub installation token request failed with status ${accessTokenResponse.response.status}.`,
      'installation_token_failed',
      ['githubAppId', 'githubAppInstallationId', 'githubAppPrivateKeyPath'],
    );
  }
  const installationToken = accessTokenResponse.json?.token?.trim();
  if (!installationToken) {
    throw new GitHubAppValidationError(
      `GitHub App installation ${installationId} did not return an installation token.`,
      'installation_token_missing',
      ['githubAppInstallationId'],
    );
  }

  const repositories = normalizeRepositoryList(input.repositories);
  const validatedRepositories: string[] = [];
  for (const repository of repositories) {
    const repoResponse = await githubRequest<Record<string, unknown>>(
      `/repos/${repository}`,
      {
        bearerToken: installationToken,
      },
    );

    if (repoResponse.response.status === 404 || repoResponse.response.status === 403) {
      throw new GitHubAppValidationError(
        `GitHub App installation ${installationId} cannot access required repository '${repository}'. Install the App on that repository or choose a different installation.`,
        'repository_access_denied',
        ['githubAppInstallationId'],
      );
    }

    if (!repoResponse.response.ok) {
      throw new GitHubAppValidationError(
        `GitHub repository access validation failed for '${repository}' with status ${repoResponse.response.status}.`,
        'repository_validation_failed',
        ['githubAppInstallationId'],
      );
    }

    validatedRepositories.push(repository);
  }

  return {
    appId,
    installationId,
    owner: installationOwner,
    ownerType: installationOwnerType,
    privateKeyPath: resolvedPrivateKeyPath,
    validatedRepositories,
  };
}
