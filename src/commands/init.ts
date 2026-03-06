import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Command } from 'commander';

import { createCommandContext } from '../lib/command-context';
import { assertComposeFilesValid } from '../lib/compose-validator';
import {
  defaultCollabConfig,
  deriveWorkspaceName,
  detectWorkspaceLayout,
  resolveRepoConfigs,
  serializeUserConfig,
  type CanonsConfig,
  type CollabConfig,
  type WorkspaceType,
} from '../lib/config';
import { checkEcosystemCompatibility } from '../lib/ecosystem';
import { generateComposeFiles } from '../lib/compose-renderer';
import { CliError } from '../lib/errors';
import { searchGitHubRepos } from '../lib/github-search';
import { parseInfraType, validateMcpUrl, type InfraType } from '../lib/infra-type';
import { parseMode, type CollabMode } from '../lib/mode';
import { parseNumber } from '../lib/parsers';
import { runOrchestration, runPerRepoOrchestration, type OrchestrationStage } from '../lib/orchestrator';
import { loadGitHubAuth, isGitHubAuthValid, runGitHubDeviceFlow, storeGitHubToken } from '../lib/github-auth';
import { promptChoice, promptMultiSelect, promptText } from '../lib/prompt';
import { assertPreflightChecks, runPreflightChecks } from '../lib/preflight';
import { ensureWritableDirectory } from '../lib/preconditions';
import { resolveInfraComposeFile, runInfraCompose } from './infra/shared';
import { resolveMcpComposeFile, runMcpCompose } from './mcp/shared';
import type { ComposeMode } from '../lib/compose-paths';
import { assistantSetupStage } from '../stages/assistant-setup';
import { canonSyncStage } from '../stages/canon-sync';
import { canonIngestStage } from '../stages/canon-ingest';
import { graphSeedStage } from '../stages/graph-seed';
import { repoScaffoldStage } from '../stages/repo-scaffold';
import { repoAnalysisStage } from '../stages/repo-analysis';
import { repoAnalysisFileOnlyStage } from '../stages/repo-analysis-fileonly';
import { agentSkillsSetupStage } from '../stages/agent-skills-setup';
import { ciSetupStage } from '../stages/ci-setup';
import { buildFileOnlyDomainPipeline, buildIndexedDomainPipeline } from '../stages/domain-gen';
import { isBusinessCanonConfigured } from '../lib/canon-resolver';
import { getEnabledProviders, PROVIDER_DEFAULTS, type ProviderKey } from '../lib/providers';
import type { Executor } from '../lib/executor';
import type { Logger } from '../lib/logger';
import { dryRunHealthOptions, loadRuntimeEnv, waitForInfraHealth, waitForMcpHealth, logServiceHealth } from '../lib/service-health';

interface InitOptions {
  force?: boolean;
  yes?: boolean;
  resume?: boolean;
  mode?: string;
  composeMode?: string;
  infraType?: string;
  mcpUrl?: string;
  outputDir?: string;
  repos?: string;
  repo?: string;
  skipMcpSnippets?: boolean;
  skipAnalysis?: boolean;
  skipCi?: boolean;
  timeoutMs?: string;
  retries?: string;
  retryDelayMs?: string;
  providers?: string;
  businessCanon?: string;
  githubToken?: string;
}

interface WizardSelection {
  mode: CollabMode;
  composeMode: ComposeMode;
  infraType: InfraType;
  mcpUrl?: string;
}

function parseComposeMode(value: string | undefined, fallback: ComposeMode = 'consolidated'): ComposeMode {
  if (!value) {
    return fallback;
  }

  if (value === 'consolidated' || value === 'split') {
    return value;
  }

  throw new CliError(`Invalid compose mode '${value}'. Use 'consolidated' or 'split'.`);
}

// Use parseNumber from lib/parsers instead of local toNumber

function inferComposeMode(config: CollabConfig): ComposeMode {
  const infraPath = path.resolve(config.workspaceDir, config.compose.infraFile);
  const mcpPath = path.resolve(config.workspaceDir, config.compose.mcpFile);

  if (fs.existsSync(infraPath) && fs.existsSync(mcpPath)) {
    return 'split';
  }

  return 'consolidated';
}

async function resolveWizardSelection(
  options: InitOptions,
  config: CollabConfig,
  logger: Logger,
): Promise<WizardSelection> {
  const defaults: WizardSelection = {
    mode: parseMode(options.mode, config.mode),
    composeMode: parseComposeMode(options.composeMode, inferComposeMode(config)),
    infraType: parseInfraType(options.infraType, config.infraType),
  };

  if (options.yes) {
    if (!options.mode) {
      process.stderr.write(
        'Info: Non-interactive mode defaults to file-only. Use --mode indexed for graph/vector features.\n',
      );
    }

    const mode: CollabMode = options.mode ? parseMode(options.mode) : 'file-only';
    const infraType = mode === 'indexed'
      ? parseInfraType(options.infraType, 'local')
      : 'local' as InfraType;

    let mcpUrl: string | undefined;
    if (infraType === 'remote') {
      if (!options.mcpUrl) {
        throw new CliError('--mcp-url is required with --infra-type remote in non-interactive mode.');
      }
      mcpUrl = validateMcpUrl(options.mcpUrl);
    }

    return {
      mode,
      composeMode: options.composeMode ? parseComposeMode(options.composeMode) : 'consolidated',
      infraType,
      mcpUrl,
    };
  }

  const mode = options.mode
    ? parseMode(options.mode)
    : await promptChoice(
        'Select setup mode:',
        [
          { value: 'file-only', label: 'file-only (skip infra + MCP startup)' },
          { value: 'indexed', label: 'indexed (start infra + MCP and enable retrieval)' },
        ],
        defaults.mode,
      );

  // ── Indexed-only: infrastructure type selection ─────────────
  let infraType: InfraType = 'local';
  let mcpUrl: string | undefined;

  if (mode === 'indexed') {
    logger.phaseHeader('collab init', 'Infrastructure');

    infraType = options.infraType
      ? parseInfraType(options.infraType)
      : await promptChoice(
          'Infrastructure type:',
          [
            { value: 'local', label: 'local (Docker Compose)' },
            { value: 'remote', label: 'remote (connect to existing MCP server)' },
          ],
          defaults.infraType,
        );

    if (infraType === 'remote') {
      const rawUrl = options.mcpUrl
        ?? await promptText('MCP server base URL:', 'http://127.0.0.1:7337');
      mcpUrl = validateMcpUrl(rawUrl);
    }
  }

  // Skip compose-mode prompt when mode is file-only or infra is remote —
  // Docker Compose configuration is only relevant for local infrastructure.
  const composeMode =
    mode === 'file-only' || infraType === 'remote'
      ? parseComposeMode(options.composeMode, 'consolidated')
      : options.composeMode
        ? parseComposeMode(options.composeMode)
        : await promptChoice(
            'Select compose generation mode:',
            [
              { value: 'consolidated', label: 'consolidated (single docker-compose.yml)' },
              { value: 'split', label: 'split (infra + mcp compose files)' },
            ],
            defaults.composeMode,
          );

  return {
    mode,
    composeMode,
    infraType,
    mcpUrl,
  };
}

function renderMcpSnippet(provider: ProviderKey, config: CollabConfig): { filename: string; content: string } | null {
  const workspace = config.workspaceDir;
  const mcpUrl = config.mcpUrl
    ? `${config.mcpUrl}/mcp`
    : 'http://127.0.0.1:7337/mcp';

  switch (provider) {
    case 'codex':
      return {
        filename: 'codex-mcp-config.toml',
        content: [
          '# Generated by collab-cli',
          '[mcp_servers.collab_architecture]',
          'transport = "http"',
          `url = "${mcpUrl}"`,
          '',
          '# If MCP_API_KEYS is configured, set a bearer token header in your client.',
          '# headers = { Authorization = "Bearer <token>" }',
          '',
          `# Workspace: ${workspace}`,
          '',
        ].join('\n'),
      };

    case 'claude':
      return {
        filename: 'claude-mcp-config.json',
        content: JSON.stringify(
          {
            _comment: 'Generated by collab-cli — merge into your Claude Code MCP settings',
            mcpServers: {
              'collab-architecture': {
                type: 'url',
                url: mcpUrl,
              },
            },
          },
          null,
          2,
        ) + '\n',
      };

    case 'gemini':
      return {
        filename: 'gemini-mcp-config.json',
        content: JSON.stringify(
          {
            _comment: 'Generated by collab-cli — merge into your Gemini MCP settings',
            mcpServers: {
              'collab-architecture': {
                type: 'url',
                url: mcpUrl,
              },
            },
          },
          null,
          2,
        ) + '\n',
      };

    case 'copilot':
      // Copilot doesn't use MCP config snippets
      return null;
  }
}

// ────────────────────────────────────────────────────────────────
// GitHub auth & business canon helpers
// ────────────────────────────────────────────────────────────────

function buildGitHubAuthStage(
  effectiveConfig: CollabConfig,
  logger: Logger,
  options: InitOptions,
): OrchestrationStage {
  return {
    id: 'github-auth',
    title: 'Authorize GitHub access',
    recovery: [
      'Set COLLAB_GITHUB_CLIENT_ID env var if OAuth App is not configured.',
      'Use --github-token <token> to provide a token directly.',
      'Run collab init --resume after fixing GitHub access.',
    ],
    run: async () => {
      // Skip if no business canon or local source — GitHub auth only needed for remote repos
      const canon = effectiveConfig.canons?.business;
      if (!canon || canon.source === 'local') {
        logger.info('No GitHub canon configured; skipping GitHub authorization.');
        return;
      }

      // Check for pre-existing valid token
      const existing = loadGitHubAuth(effectiveConfig.collabDir);
      if (existing) {
        const valid = await isGitHubAuthValid(existing);
        if (valid) {
          logger.info('GitHub authorization already configured and valid.');
          return;
        }
        logger.info('Existing GitHub token is invalid or expired. Re-authorizing...');
      }

      // --github-token flag: store directly
      if (options.githubToken) {
        storeGitHubToken(effectiveConfig.collabDir, options.githubToken);
        logger.info('GitHub token stored from --github-token flag.');
        return;
      }

      // --yes without token: fail
      if (options.yes) {
        throw new CliError(
          'GitHub authorization required. Use --github-token <token> in non-interactive mode.',
        );
      }

      // Interactive: run Device Flow
      await runGitHubDeviceFlow(effectiveConfig.collabDir, (msg) => logger.info(msg));
    },
  };
}

const LOCAL_PATH_RE = /^[/~.]/;

function parseBusinessCanonOption(value: string | undefined): CanonsConfig | undefined {
  if (!value || value === 'none' || value === 'skip') {
    return undefined;
  }

  // Detect local path: starts with /, ./, ../, or ~
  if (LOCAL_PATH_RE.test(value)) {
    const resolved = path.resolve(value.replace(/^~/, os.homedir()));
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new CliError(`Not a valid directory: ${resolved}`);
    }
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

async function resolveBusinessCanon(
  options: InitOptions,
  config: CollabConfig,
  logger: Logger,
): Promise<CanonsConfig | undefined> {
  // CLI flag takes priority
  if (options.businessCanon) {
    return parseBusinessCanonOption(options.businessCanon);
  }

  // --yes without --business-canon: mandatory error
  if (options.yes) {
    throw new CliError(
      '--business-canon is required with --yes. Use --business-canon owner/repo, --business-canon /local/path, or --business-canon none.',
    );
  }

  // Interactive: choose source
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

  const resolved = path.resolve(rawPath.replace(/^~/, os.homedir()));
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new CliError(`Not a valid directory: ${resolved}`);
  }

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

    const results = await searchGitHubRepos(query, token, 8);

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

async function ensureGitHubAuth(collabDir: string, logger: Logger): Promise<string> {
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

// ────────────────────────────────────────────────────────────────
// Shared inline stages used by both pipelines
// ────────────────────────────────────────────────────────────────

function buildPreflightStage(executor: Executor, logger: Logger, mode?: string): OrchestrationStage {
  return {
    id: 'preflight',
    title: 'Run preflight checks',
    recovery: [
      'Install missing dependencies reported by preflight.',
      'Run collab init --resume after fixing prerequisites.',
    ],
    run: () => {
      const checks = runPreflightChecks(executor, { mode });
      assertPreflightChecks(checks, logger);
    },
  };
}

function buildConfigStage(
  effectiveConfig: CollabConfig,
  executor: Executor,
  logger: Logger,
  configExistedBefore: boolean,
  force?: boolean,
): OrchestrationStage {
  return {
    id: 'environment-setup',
    title: 'Write local collab configuration',
    recovery: [
      'Verify write permissions for .collab and workspace directory.',
      'Run collab init --resume once permissions are fixed.',
    ],
    run: () => {
      if (configExistedBefore && !force) {
        logger.info('Existing configuration detected; preserving it. Use --force to overwrite.');
        return;
      }

      executor.ensureDirectory(effectiveConfig.collabDir);
      executor.writeFile(
        effectiveConfig.configFile,
        `${serializeUserConfig(effectiveConfig)}\n`,
        { description: 'write collab config' },
      );
    },
  };
}

// ────────────────────────────────────────────────────────────────
// Workspace helpers
// ────────────────────────────────────────────────────────────────

interface WorkspaceResolution {
  name: string;
  type: WorkspaceType;
  repos: string[];
}

function parseRepos(value: string | undefined): string[] | null {
  if (!value) return null;
  return value.split(',').map((r) => r.trim()).filter(Boolean);
}

async function resolveWorkspace(
  workspaceDir: string,
  options: InitOptions,
  logger: Logger,
): Promise<WorkspaceResolution | null> {
  const name = deriveWorkspaceName(workspaceDir);

  // Explicit --repos flag takes priority
  const explicit = parseRepos(options.repos);
  if (explicit && explicit.length > 0) {
    const type = explicit.length >= 2 ? 'multi-repo' : 'mono-repo';
    logger.info(`Workspace mode: ${explicit.length} repo(s) specified: ${explicit.join(', ')}`);
    return { name, type, repos: explicit };
  }

  // Auto-detect workspace layout
  const layout = detectWorkspaceLayout(workspaceDir);

  if (layout) {
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

    // mono-repo auto-detected
    logger.info(`Mono-repo workspace detected: ${layout.repos.join(', ')}`);
    return { name, type: 'mono-repo', repos: layout.repos };
  }

  // No repos found
  if (options.yes) {
    // Non-interactive with no repos → treat cwd as mono-repo
    logger.info('No repos discovered; initializing as mono-repo workspace.');
    return { name, type: 'mono-repo', repos: ['.'] };
  }

  return null;
}

// ────────────────────────────────────────────────────────────────
// Workspace pipeline builders
// ────────────────────────────────────────────────────────────────

function buildWorkspaceStages(
  effectiveConfig: CollabConfig,
  executor: Executor,
  logger: Logger,
  configExistedBefore: boolean,
  options: InitOptions,
): OrchestrationStage[] {
  return [
    buildPreflightStage(executor, logger),
    buildConfigStage(effectiveConfig, executor, logger, configExistedBefore, options.force),
    buildGitHubAuthStage(effectiveConfig, logger, options),
    assistantSetupStage,
    canonSyncStage,
  ];
}

function buildPerRepoStages(mode: CollabMode): OrchestrationStage[] {
  const analysisStage = mode === 'indexed' ? repoAnalysisStage : repoAnalysisFileOnlyStage;
  return [
    repoScaffoldStage,
    analysisStage,
    ciSetupStage,
    agentSkillsSetupStage,
  ];
}

function buildInfraStages(
  effectiveConfig: CollabConfig,
  executor: Executor,
  logger: Logger,
  options: InitOptions,
  composeMode: ComposeMode,
): OrchestrationStage[] {
  const health = {
    timeoutMs: parseNumber(options.timeoutMs, 5_000),
    retries: parseNumber(options.retries, 15),
    retryDelayMs: parseNumber(options.retryDelayMs, 2_000),
  };

  return [
    {
      id: 'compose-generation',
      title: 'Generate and validate compose files',
      recovery: [
        'Run collab compose validate to inspect configuration errors.',
        'Run collab init --resume after fixing compose inputs.',
      ],
      run: () => {
        const generation = generateComposeFiles({
          config: effectiveConfig,
          mode: composeMode,
          outputDirectory: options.outputDir,
          logger,
          executor,
        });

        for (const warning of generation.driftWarnings) {
          logger.warn(warning);
        }

        assertComposeFilesValid(
          generation.files.map((file) => file.filePath),
          effectiveConfig.workspaceDir,
          executor,
        );
      },
    },
    {
      id: 'infra-start',
      title: 'Start infrastructure services',
      recovery: [
        'Run collab infra status to inspect Qdrant and Nebula.',
        'Run collab init --resume after infra services are healthy.',
      ],
      run: async () => {
        // Check if infra is already running (e.g. from a workspace-level init)
        const env = loadRuntimeEnv(effectiveConfig);
        const probe = await waitForInfraHealth(env, { ...health, retries: 1 });
        if (probe.ok) {
          logger.info('Infrastructure already running — skipping docker compose up.');
          logServiceHealth(logger, 'infra health', probe);
          return;
        }
        const selection = resolveInfraComposeFile(effectiveConfig, options.outputDir, undefined);
        await runInfraCompose(logger, executor, effectiveConfig, selection, 'up', { health });
      },
    },
    {
      id: 'mcp-start',
      title: 'Start MCP service',
      recovery: [
        'Run collab mcp status to inspect MCP runtime.',
        'Run collab init --resume after MCP health endpoint responds.',
      ],
      run: async () => {
        // Check if MCP is already running (e.g. from a workspace-level init)
        const env = loadRuntimeEnv(effectiveConfig);
        const probe = await waitForMcpHealth(env, { ...health, retries: 1 });
        if (probe.ok) {
          logger.info('MCP service already running — skipping docker compose up.');
          logServiceHealth(logger, 'mcp health', probe);
          return;
        }
        const selection = resolveMcpComposeFile(effectiveConfig, options.outputDir, undefined);
        await runMcpCompose(logger, executor, effectiveConfig, selection, 'up', { health });
      },
    },
    {
      id: 'mcp-client-config',
      title: 'Generate MCP client config snippets',
      recovery: [
        'Verify permissions in .collab directory.',
        'Run collab init --resume to regenerate MCP config snippets.',
      ],
      run: () => {
        if (options.skipMcpSnippets) {
          logger.info('Skipping MCP snippet generation by user choice.');
          return;
        }

        const enabled = getEnabledProviders(effectiveConfig);
        if (enabled.length === 0) {
          logger.info('No providers configured; skipping MCP snippet generation.');
          return;
        }

        for (const provider of enabled) {
          const snippet = renderMcpSnippet(provider, effectiveConfig);
          if (!snippet) continue;
          const target = path.join(effectiveConfig.collabDir, snippet.filename);
          executor.writeFile(target, snippet.content, {
            description: `write ${PROVIDER_DEFAULTS[provider].label} MCP config snippet`,
          });
        }

        logger.info(
          `Generated MCP snippets for: ${enabled.map((k) => PROVIDER_DEFAULTS[k].label).join(', ')}`,
        );
      },
    },
    graphSeedStage,
    canonIngestStage,
  ];
}

// ────────────────────────────────────────────────────────────────
// Remote infra stages (no Docker — connect to existing MCP)
// ────────────────────────────────────────────────────────────────

function buildRemoteInfraStages(
  effectiveConfig: CollabConfig,
  executor: Executor,
  logger: Logger,
  options: InitOptions,
  mcpUrl: string,
): OrchestrationStage[] {
  const health = dryRunHealthOptions(executor, {
    timeoutMs: parseNumber(options.timeoutMs, 5_000),
    retries: parseNumber(options.retries, 15),
    retryDelayMs: parseNumber(options.retryDelayMs, 2_000),
  });

  return [
    {
      id: 'mcp-health-check',
      title: 'Verify remote MCP service health',
      recovery: [
        'Check that the remote MCP server is running and accessible.',
        'Verify the --mcp-url value points to a healthy MCP endpoint.',
        'Run collab init --resume after fixing remote connectivity.',
      ],
      run: async () => {
        const parsed = new URL(mcpUrl);
        const env: Record<string, string> = {
          MCP_HOST: parsed.hostname,
          MCP_PORT: parsed.port || (parsed.protocol === 'https:' ? '443' : '80'),
        };
        const probe = await waitForMcpHealth(env, health);
        if (!probe.ok) {
          throw new CliError(`Remote MCP is not healthy at ${mcpUrl}: ${probe.errors.join(', ')}`);
        }
        logServiceHealth(logger, 'remote MCP health', probe);
      },
    },
    {
      id: 'mcp-client-config',
      title: 'Generate MCP client config snippets',
      recovery: [
        'Verify permissions in .collab directory.',
        'Run collab init --resume to regenerate MCP config snippets.',
      ],
      run: () => {
        if (options.skipMcpSnippets) {
          logger.info('Skipping MCP snippet generation by user choice.');
          return;
        }

        const enabled = getEnabledProviders(effectiveConfig);
        if (enabled.length === 0) {
          logger.info('No providers configured; skipping MCP snippet generation.');
          return;
        }

        for (const provider of enabled) {
          const snippet = renderMcpSnippet(provider, effectiveConfig);
          if (!snippet) continue;
          const target = path.join(effectiveConfig.collabDir, snippet.filename);
          executor.writeFile(target, snippet.content, {
            description: `write ${PROVIDER_DEFAULTS[provider].label} MCP config snippet`,
          });
        }

        logger.info(
          `Generated MCP snippets for: ${enabled.map((k) => PROVIDER_DEFAULTS[k].label).join(', ')}`,
        );
      },
    },
    graphSeedStage,
    canonIngestStage,
  ];
}

// ────────────────────────────────────────────────────────────────
// File-only pipeline (8 stages)
// ────────────────────────────────────────────────────────────────

function buildFileOnlyPipeline(
  effectiveConfig: CollabConfig,
  executor: Executor,
  logger: Logger,
  configExistedBefore: boolean,
  options: InitOptions,
): OrchestrationStage[] {
  return [
    buildPreflightStage(executor, logger),                     // 1
    buildConfigStage(effectiveConfig, executor, logger,
      configExistedBefore, options.force),                     // 2
    buildGitHubAuthStage(effectiveConfig, logger, options),    // 3
    assistantSetupStage,                                       // 4
    canonSyncStage,                                            // 5
    repoScaffoldStage,                                         // 6
    repoAnalysisFileOnlyStage,                                 // 7
    ciSetupStage,                                              // 8
    agentSkillsSetupStage,                                     // 9
  ];
}

// ────────────────────────────────────────────────────────────────
// Indexed pipeline (15 stages)
// ────────────────────────────────────────────────────────────────

function buildIndexedPipeline(
  effectiveConfig: CollabConfig,
  executor: Executor,
  logger: Logger,
  configExistedBefore: boolean,
  options: InitOptions,
  composeMode: ComposeMode,
  infraType: InfraType = 'local',
  mcpUrl?: string,
): OrchestrationStage[] {
  const infraStages = infraType === 'remote' && mcpUrl
    ? buildRemoteInfraStages(effectiveConfig, executor, logger, options, mcpUrl)
    : buildInfraStages(effectiveConfig, executor, logger, options, composeMode);

  return [
    // Phase A — Local setup (shared with file-only)
    buildPreflightStage(executor, logger, infraType === 'local' ? 'indexed' : undefined),
    buildConfigStage(effectiveConfig, executor, logger,
      configExistedBefore, options.force),
    buildGitHubAuthStage(effectiveConfig, logger, options),
    assistantSetupStage,
    canonSyncStage,
    repoScaffoldStage,
    repoAnalysisStage,
    ciSetupStage,
    agentSkillsSetupStage,

    // Phase B — Infrastructure + Phase C — Ingestion
    ...infraStages,
  ];
}

// ────────────────────────────────────────────────────────────────
// Standalone infra phase  (collab init infra)
// ────────────────────────────────────────────────────────────────

async function runInfraOnly(
  context: { config: CollabConfig; executor: Executor; logger: Logger },
  options: InitOptions,
): Promise<void> {
  // Build an indexed config — infra always implies indexed mode.
  // If a config already exists we honour it; otherwise bootstrap one.
  const effectiveConfig: CollabConfig = {
    ...defaultCollabConfig(context.config.workspaceDir),
    ...context.config,
    mode: 'indexed',
  };

  // Persist config so subsequent commands (infra status, mcp status) work.
  const configExists = fs.existsSync(effectiveConfig.configFile);
  if (!configExists) {
    context.executor.ensureDirectory(effectiveConfig.collabDir);
    context.executor.writeFile(
      effectiveConfig.configFile,
      `${serializeUserConfig(effectiveConfig)}\n`,
      { description: 'write collab config (infra bootstrap)' },
    );
  }

  const infraType = parseInfraType(options.infraType, effectiveConfig.infraType);
  let mcpUrl: string | undefined;

  if (infraType === 'remote') {
    if (!options.mcpUrl && !effectiveConfig.mcpUrl) {
      throw new CliError('--mcp-url is required for remote infrastructure.');
    }
    mcpUrl = options.mcpUrl ? validateMcpUrl(options.mcpUrl) : effectiveConfig.mcpUrl;
    effectiveConfig.infraType = infraType;
    effectiveConfig.mcpUrl = mcpUrl;
  }

  const composeMode = parseComposeMode(options.composeMode, inferComposeMode(effectiveConfig));
  const infraLabel = infraType === 'remote' ? 'Remote MCP services' : 'Docker + MCP services';

  context.logger.phaseHeader('Infrastructure', infraLabel);

  const infraStages = infraType === 'remote' && mcpUrl
    ? buildRemoteInfraStages(effectiveConfig, context.executor, context.logger, options, mcpUrl)
    : buildInfraStages(effectiveConfig, context.executor, context.logger, options, composeMode);

  await runOrchestration(
    {
      workflowId: 'init:infra',
      config: effectiveConfig,
      executor: context.executor,
      logger: context.logger,
      resume: options.resume,
      mode: `indexed (infra ${infraType})`,
      stageOptions: { outputDir: options.outputDir },
    },
    infraStages,
  );

  // Summary
  context.logger.phaseHeader('Infrastructure Ready');
  const summaryEntries = [
    { label: 'Phase', value: `infra ${infraType}` },
    { label: 'Dry-run', value: context.executor.dryRun ? 'yes' : 'no' },
    { label: 'Config', value: effectiveConfig.configFile },
  ];

  if (infraType === 'remote' && mcpUrl) {
    summaryEntries.splice(1, 0, { label: 'MCP URL', value: mcpUrl });
  } else {
    summaryEntries.splice(1, 0, { label: 'Compose mode', value: composeMode });
  }

  context.logger.summaryFooter(summaryEntries);
}

// ────────────────────────────────────────────────────────────────
// Repo domain generation  (collab init --repo=<package>)
// ────────────────────────────────────────────────────────────────

/**
 * Resolves and validates the path to a repository package.
 *
 * Resolution order:
 *   1. Absolute path → use directly
 *   2. Relative path from workspace dir → resolve
 *   3. Name within workspace → join with workspaceDir
 *
 * @throws {CliError} When the path is not found or is not a directory.
 */
function resolveRepoPath(repoValue: string, config: CollabConfig): string {
  const isDirectory = (p: string): boolean => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  };

  // 1. Absolute path
  if (path.isAbsolute(repoValue)) {
    if (!fs.existsSync(repoValue)) {
      throw new CliError(`Repository path not found: ${repoValue}`);
    }
    if (!isDirectory(repoValue)) {
      throw new CliError(`Repository path is not a directory: ${repoValue}`);
    }
    return repoValue;
  }

  // 2. Relative path from workspace dir (respects --cwd)
  const fromCwd = path.resolve(config.workspaceDir, repoValue);
  if (isDirectory(fromCwd)) {
    return fromCwd;
  }

  // 3. Name within workspace
  const fromWorkspace = path.join(config.workspaceDir, repoValue);
  if (isDirectory(fromWorkspace)) {
    return fromWorkspace;
  }

  throw new CliError(
    `Repository "${repoValue}" not found.\n` +
      `Searched:\n` +
      `  - ${fromCwd}\n` +
      `  - ${fromWorkspace}\n` +
      `Provide an absolute path, a relative path from cwd, or a repo name within your workspace.`,
  );
}

async function runRepoDomainGeneration(
  context: { config: CollabConfig; executor: Executor; logger: Logger },
  options: InitOptions,
): Promise<void> {
  const repoValue = options.repo!;

  // Build a minimal config — reuse existing if available
  const effectiveConfig: CollabConfig = {
    ...defaultCollabConfig(context.config.workspaceDir),
    ...context.config,
  };

  // Resolve business canon if passed via flag (but don't require it for file-only)
  const canons = options.businessCanon ? parseBusinessCanonOption(options.businessCanon) : undefined;
  if (canons) {
    effectiveConfig.canons = canons;
  }

  // Store GitHub token if provided (required for indexed push/sync)
  if (options.githubToken) {
    if (context.executor.dryRun) {
      context.logger.info('[dry-run] Would store GitHub token from --github-token flag.');
    } else {
      storeGitHubToken(effectiveConfig.collabDir, options.githubToken);
      context.logger.info('GitHub token stored from --github-token flag.');
    }
  }

  // Resolve mode
  let mode: CollabMode;
  if (options.mode) {
    mode = parseMode(options.mode);
  } else if (options.yes) {
    mode = 'file-only';
  } else {
    mode = await promptChoice(
      'Select domain generation mode:',
      [
        { value: 'file-only', label: 'file-only (write domain files to local repo only)' },
        { value: 'indexed', label: 'indexed (write to business canon + ingest into MCP)' },
      ],
      'file-only',
    );
  }

  // Validate prerequisites
  if (mode === 'indexed' && !isBusinessCanonConfigured(effectiveConfig)) {
    throw new CliError(
      'Business canon is required for indexed mode. ' +
        'Use --business-canon owner/repo to configure it, or use --mode file-only.',
    );
  }

  // Resolve repo path
  const repoPath = resolveRepoPath(repoValue, effectiveConfig);
  const repoName = path.basename(repoPath);

  context.logger.phaseHeader('Domain Generation', `${repoName} (${mode})`);

  // Build pipeline
  const stages = mode === 'file-only'
    ? buildFileOnlyDomainPipeline()
    : buildIndexedDomainPipeline();

  // Execute
  await runOrchestration(
    {
      workflowId: 'init:repo-domain',
      config: effectiveConfig,
      executor: context.executor,
      logger: context.logger,
      resume: options.resume,
      mode: `${mode} (repo domain)`,
      stageOptions: {
        _repoPath: repoPath,
        yes: options.yes,
        providers: options.providers,
      },
    },
    stages,
  );

  // Summary
  context.logger.phaseHeader('Domain Generation Complete');
  context.logger.summaryFooter([
    { label: 'Mode', value: mode },
    { label: 'Repository', value: repoName },
    { label: 'Dry-run', value: context.executor.dryRun ? 'yes' : 'no' },
  ]);
}

// ────────────────────────────────────────────────────────────────
// Command registration
// ────────────────────────────────────────────────────────────────

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Run onboarding wizard and orchestrate setup stages')
    .argument('[phase]', 'Optional phase to run in isolation (e.g. "infra")')
    .option('-f, --force', 'Overwrite existing .collab/config.json with new wizard selection')
    .option('--yes', 'Accept wizard defaults and run non-interactively')
    .option('--resume', 'Resume from the last incomplete wizard stage')
    .option('--mode <mode>', 'Wizard mode: file-only|indexed')
    .option('--compose-mode <mode>', 'Compose mode: consolidated|split')
    .option('--infra-type <type>', 'Infrastructure type: local|remote (indexed mode only)')
    .option('--mcp-url <url>', 'MCP server base URL for remote infrastructure')
    .option('--output-dir <directory>', 'Directory used to write compose outputs')
    .option('--repos <list>', 'Comma-separated repo directories for workspace mode')
    .option('--repo <package>', 'Generate domain definition from package analysis')
    .option('--skip-mcp-snippets', 'Skip MCP client config snippet generation')
    .option('--skip-analysis', 'Skip AI-powered repository analysis stage')
    .option('--skip-ci', 'Skip CI workflow generation')
    .option('--providers <list>', 'Comma-separated AI provider list (codex,claude,gemini,copilot)')
    .option('--business-canon <value>', 'Business canon: owner/repo, /local/path, or "none" to skip')
    .option('--github-token <token>', 'GitHub token for non-interactive mode')
    .option('--timeout-ms <ms>', 'Per-check timeout in milliseconds', '5000')
    .option('--retries <count>', 'Health check retries', '15')
    .option('--retry-delay-ms <ms>', 'Delay between retries in milliseconds', '2000')
    .addHelpText(
      'after',
      `
Examples:
  collab init
  collab init --yes
  collab init --yes --mode file-only
  collab init --yes --mode indexed
  collab init --repos api,web,shared --yes
  collab init --repo collab-chat-ai-pkg --mode file-only
  collab init --repo collab-chat-ai-pkg --mode indexed
  collab init --yes --mode indexed --infra-type remote --mcp-url http://my-server:7337 --business-canon none
  collab init --resume
  collab init infra
  collab init infra --resume
`,
    )
    .action(async (phase: string | undefined, options: InitOptions, command: Command) => {
      const context = createCommandContext(command);
      ensureWritableDirectory(context.config.workspaceDir);

      // ── Phase shortcut: collab init infra ───────────────────
      if (phase === 'infra') {
        await runInfraOnly(context, options);
        return;
      }

      if (phase) {
        throw new CliError(`Unknown init phase "${phase}". Available phases: infra`);
      }

      // ── Repo domain generation: collab init --repo <pkg> ───
      if (options.repo) {
        await runRepoDomainGeneration(context, options);

        // Ecosystem compatibility checks (same as full wizard)
        const compatibility = await checkEcosystemCompatibility(context.config, {
          dryRun: context.executor.dryRun,
        });
        for (const check of compatibility) {
          const prefix = check.ok ? '[PASS]' : '[WARN]';
          context.logger.result(`${prefix} ${check.id}: ${check.detail}`);
          if (!check.ok && check.fix) context.logger.result(`       fix: ${check.fix}`);
        }

        return;
      }

      // ── Full wizard flow ────────────────────────────────────
      const configExistedBefore = fs.existsSync(context.config.configFile);

      if (options.force) {
        context.logger.warn('Force mode enabled: configuration will be overwritten with wizard selections.');
      }

      // ── Step 1: Configuration wizard ────────────────────────
      context.logger.phaseHeader('collab init', 'Configuration');

      const selections = await resolveWizardSelection(options, context.config, context.logger);
      const preserveExisting = configExistedBefore && !options.force;

      const effectiveConfig: CollabConfig = {
        ...defaultCollabConfig(context.config.workspaceDir),
        ...context.config,
        mode: preserveExisting ? context.config.mode : selections.mode,
        infraType: preserveExisting ? context.config.infraType : selections.infraType,
        mcpUrl: preserveExisting ? context.config.mcpUrl : selections.mcpUrl,
      };

      // ── Step 2: Business canon configuration ──────────────────
      const canons = await resolveBusinessCanon(options, effectiveConfig, context.logger);
      if (canons) {
        effectiveConfig.canons = canons;
      }

      const stageOptions: Record<string, unknown> = {
        yes: options.yes,
        providers: options.providers,
        outputDir: options.outputDir,
        skipAnalysis: options.skipAnalysis,
        skipCi: options.skipCi,
      };

      // ── Workspace detection ───────────────────────────────────
      // Prefer persisted workspace config when it exists (unless
      // --force or explicit --repos override is provided).
      const ws =
        !options.force && !options.repos && context.config.workspace
          ? context.config.workspace
          : await resolveWorkspace(
              context.config.workspaceDir,
              options,
              context.logger,
            );

      if (ws) {
        // ── WORKSPACE MODE ────────────────────────────────────
        effectiveConfig.workspace = { name: ws.name, type: ws.type, repos: ws.repos };
        effectiveConfig.compose = {
          ...effectiveConfig.compose,
          projectName: `collab-${ws.name}`,
        };
        const repoConfigs = resolveRepoConfigs(effectiveConfig);

        // Phase W — workspace-level stages
        context.logger.phaseHeader('Workspace Setup', `${ws.repos.length} repositories (${ws.type})`);

        const workspaceStages = buildWorkspaceStages(
          effectiveConfig, context.executor, context.logger,
          configExistedBefore, options,
        );

        await runOrchestration(
          {
            workflowId: 'init',
            config: effectiveConfig,
            executor: context.executor,
            logger: context.logger,
            resume: options.resume,
            mode: `${selections.mode} (workspace)`,
            stageOptions,
          },
          workspaceStages,
        );

        // Phase R — per-repo stages
        context.logger.phaseHeader('Repository Analysis', `${selections.mode} mode`);

        const perRepoStages = buildPerRepoStages(selections.mode);

        for (const [i, rc] of repoConfigs.entries()) {
          context.logger.repoHeader(rc.name, i + 1, repoConfigs.length);
          await runPerRepoOrchestration(
            {
              workflowId: 'init',
              config: effectiveConfig,
              executor: context.executor,
              logger: context.logger,
              resume: options.resume,
              stageOptions,
            },
            rc,
            perRepoStages,
          );
        }

        // Phase I — infra stages (indexed only)
        if (selections.mode === 'indexed') {
          const infraLabel = selections.infraType === 'remote'
            ? 'Remote MCP services'
            : 'Docker + MCP services';
          context.logger.phaseHeader('Infrastructure', infraLabel);

          const infraStages = selections.infraType === 'remote' && selections.mcpUrl
            ? buildRemoteInfraStages(
                effectiveConfig, context.executor, context.logger,
                options, selections.mcpUrl,
              )
            : buildInfraStages(
                effectiveConfig, context.executor, context.logger,
                options, selections.composeMode,
              );

          await runOrchestration(
            {
              workflowId: 'init:infra',
              config: effectiveConfig,
              executor: context.executor,
              logger: context.logger,
              resume: options.resume,
              mode: 'indexed (infra)',
              stageOptions,
            },
            infraStages,
          );
        }
      } else {
        // ── SINGLE-REPO MODE (unchanged) ──────────────────────
        context.logger.phaseHeader('Project Setup', selections.mode);

        const stages = selections.mode === 'file-only'
          ? buildFileOnlyPipeline(effectiveConfig, context.executor, context.logger, configExistedBefore, options)
          : buildIndexedPipeline(effectiveConfig, context.executor, context.logger, configExistedBefore, options, selections.composeMode, selections.infraType, selections.mcpUrl);

        await runOrchestration(
          {
            workflowId: 'init',
            config: effectiveConfig,
            executor: context.executor,
            logger: context.logger,
            resume: options.resume,
            mode: selections.mode,
            stageOptions,
          },
          stages,
        );
      }

      // ── Summary ───────────────────────────────────────────
      context.logger.phaseHeader('Setup Complete');

      const enabledProviders = getEnabledProviders(effectiveConfig);
      const providerLabel = enabledProviders.length > 0
        ? enabledProviders.map((k) => PROVIDER_DEFAULTS[k].label).join(', ')
        : '(none configured)';

      const summaryEntries = [
        { label: 'Mode', value: selections.mode },
        { label: 'Dry-run', value: context.executor.dryRun ? 'yes' : 'no' },
        { label: 'Config', value: effectiveConfig.configFile },
        { label: 'Providers', value: providerLabel },
      ];

      if (ws) {
        summaryEntries.splice(1, 0,
          { label: 'Workspace', value: `${ws.name} (${ws.type})` },
          { label: 'Repos', value: ws.repos.join(', ') },
        );
      }

      if (selections.mode === 'indexed') {
        summaryEntries.push({ label: 'Infrastructure', value: selections.infraType });
        if (selections.infraType === 'remote' && selections.mcpUrl) {
          summaryEntries.push({ label: 'MCP URL', value: selections.mcpUrl });
        } else {
          summaryEntries.push({ label: 'Compose mode', value: selections.composeMode });
        }
      }

      context.logger.summaryFooter(summaryEntries);

      // Ecosystem compatibility checks
      const compatibility = await checkEcosystemCompatibility(effectiveConfig, {
        dryRun: context.executor.dryRun,
      });

      for (const check of compatibility) {
        const prefix = check.ok ? '[PASS]' : '[WARN]';
        context.logger.result(`${prefix} ${check.id}: ${check.detail}`);
        if (!check.ok && check.fix) {
          context.logger.result(`       fix: ${check.fix}`);
        }
      }

      // ── Next steps guidance ──────────────────────────────
      context.logger.info('');
      context.logger.info('Next steps:');

      if (selections.mode === 'file-only') {
        context.logger.info('  - Upgrade to indexed mode for graph/vector features:');
        context.logger.info('      collab init --mode indexed');
      }

      if (selections.mode === 'indexed') {
        context.logger.info('  - Populate graph and vector stores:');
        context.logger.info('      collab canon rebuild --confirm');
      }

      if (ws) {
        context.logger.info('  - Initialize domain repos:');
        context.logger.info('      collab init --repo=<package-name>');
      }

      context.logger.info('  - Verify full setup health:');
      context.logger.info('      collab doctor');
      context.logger.info('  - Finalize and archive when done:');
      context.logger.info('      collab end');

      if (!options.force && configExistedBefore) {
        context.logger.debug('Existing configuration was reused.');
      }
    });
}
