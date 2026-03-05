import fs from 'node:fs';
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
import { parseMode, type CollabMode } from '../lib/mode';
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
import { loadRuntimeEnv, waitForInfraHealth, waitForMcpHealth, logServiceHealth } from '../lib/service-health';

interface InitOptions {
  force?: boolean;
  yes?: boolean;
  resume?: boolean;
  mode?: string;
  composeMode?: string;
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

function toNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

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
): Promise<WizardSelection> {
  const defaults: WizardSelection = {
    mode: parseMode(options.mode, config.mode),
    composeMode: parseComposeMode(options.composeMode, inferComposeMode(config)),
  };

  if (options.yes) {
    return {
      ...defaults,
      mode: options.mode ? parseMode(options.mode) : 'file-only',
      composeMode: options.composeMode ? parseComposeMode(options.composeMode) : 'consolidated',
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

  // Skip compose-mode prompt when mode is file-only — no Docker/MCP
  // infrastructure is used, so compose configuration is irrelevant.
  const composeMode =
    mode === 'file-only'
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
  };
}

function renderMcpSnippet(provider: ProviderKey, config: CollabConfig): { filename: string; content: string } | null {
  const workspace = config.workspaceDir;
  const mcpUrl = 'http://127.0.0.1:7337/mcp';

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
      // Skip if no business canon is configured — GitHub auth is only needed for private repos
      if (!effectiveConfig.canons?.business) {
        logger.info('No business canon configured; skipping GitHub authorization.');
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

function parseBusinessCanonOption(value: string | undefined): CanonsConfig | undefined {
  if (!value || value === 'none' || value === 'skip') {
    return undefined;
  }

  if (!value.includes('/')) {
    throw new CliError(
      `Invalid business canon format "${value}". Use "owner/repo" or "none" to skip.`,
    );
  }

  return {
    business: {
      repo: value,
      branch: 'main',
      localDir: 'business',
    },
  };
}

async function resolveBusinessCanon(
  options: InitOptions,
  logger: Logger,
): Promise<CanonsConfig | undefined> {
  // CLI flag takes priority
  if (options.businessCanon) {
    return parseBusinessCanonOption(options.businessCanon);
  }

  // --yes without --business-canon: mandatory error
  if (options.yes) {
    throw new CliError(
      '--business-canon is required with --yes. Use --business-canon owner/repo or --business-canon none.',
    );
  }

  // Interactive prompt
  const repo = await promptText(
    'Business architecture canon repo (owner/repo, empty to skip):',
  );

  if (!repo) {
    logger.info('No business canon configured.');
    return undefined;
  }

  if (!repo.includes('/')) {
    throw new CliError(`Invalid format "${repo}". Use "owner/repo".`);
  }

  const branch = await promptText('Business canon branch:', 'main');

  return {
    business: {
      repo,
      branch: branch || 'main',
      localDir: 'business',
    },
  };
}

// ────────────────────────────────────────────────────────────────
// Shared inline stages used by both pipelines
// ────────────────────────────────────────────────────────────────

function buildPreflightStage(executor: Executor, logger: Logger): OrchestrationStage {
  return {
    id: 'preflight',
    title: 'Run preflight checks',
    recovery: [
      'Install missing dependencies reported by preflight.',
      'Run collab init --resume after fixing prerequisites.',
    ],
    run: () => {
      const checks = runPreflightChecks(executor);
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
    timeoutMs: toNumber(options.timeoutMs, 5_000),
    retries: toNumber(options.retries, 15),
    retryDelayMs: toNumber(options.retryDelayMs, 2_000),
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
): OrchestrationStage[] {
  return [
    // Phase A — Local setup (shared with file-only)
    buildPreflightStage(executor, logger),                     // 1
    buildConfigStage(effectiveConfig, executor, logger,
      configExistedBefore, options.force),                     // 2
    buildGitHubAuthStage(effectiveConfig, logger, options),    // 3
    assistantSetupStage,                                       // 4
    canonSyncStage,                                            // 5
    repoScaffoldStage,                                         // 6
    repoAnalysisStage,                                         // 7
    ciSetupStage,                                              // 8
    agentSkillsSetupStage,                                     // 9

    // Phase B — Infrastructure + Phase C — Ingestion  (9-14)
    ...buildInfraStages(effectiveConfig, executor, logger, options, composeMode),
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

  const composeMode = parseComposeMode(options.composeMode, inferComposeMode(effectiveConfig));

  context.logger.phaseHeader('Infrastructure', 'Docker + MCP services');

  const infraStages = buildInfraStages(
    effectiveConfig,
    context.executor,
    context.logger,
    options,
    composeMode,
  );

  await runOrchestration(
    {
      workflowId: 'init:infra',
      config: effectiveConfig,
      executor: context.executor,
      logger: context.logger,
      resume: options.resume,
      mode: 'indexed (infra)',
      stageOptions: { outputDir: options.outputDir },
    },
    infraStages,
  );

  // Summary
  context.logger.phaseHeader('Infrastructure Ready');
  context.logger.summaryFooter([
    { label: 'Phase', value: 'infra only' },
    { label: 'Compose mode', value: composeMode },
    { label: 'Dry-run', value: context.executor.dryRun ? 'yes' : 'no' },
    { label: 'Config', value: effectiveConfig.configFile },
  ]);
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
    .option('--output-dir <directory>', 'Directory used to write compose outputs')
    .option('--repos <list>', 'Comma-separated repo directories for workspace mode')
    .option('--repo <package>', 'Generate domain definition from package analysis')
    .option('--skip-mcp-snippets', 'Skip MCP client config snippet generation')
    .option('--skip-analysis', 'Skip AI-powered repository analysis stage')
    .option('--skip-ci', 'Skip CI workflow generation')
    .option('--providers <list>', 'Comma-separated AI provider list (codex,claude,gemini,copilot)')
    .option('--business-canon <owner/repo>', 'Business canon repo (owner/repo or "none" to skip)')
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

      const selections = await resolveWizardSelection(options, context.config);
      const preserveExisting = configExistedBefore && !options.force;

      const effectiveConfig: CollabConfig = {
        ...defaultCollabConfig(context.config.workspaceDir),
        ...context.config,
        mode: preserveExisting ? context.config.mode : selections.mode,
      };

      // ── Step 2: Business canon configuration ──────────────────
      const canons = await resolveBusinessCanon(options, context.logger);
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
          context.logger.phaseHeader('Infrastructure', 'Docker + MCP services');

          const infraStages = buildInfraStages(
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
          : buildIndexedPipeline(effectiveConfig, context.executor, context.logger, configExistedBefore, options, selections.composeMode);

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
        summaryEntries.splice(ws ? 3 : 1, 0, { label: 'Compose mode', value: selections.composeMode });
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

      if (!options.force && configExistedBefore) {
        context.logger.debug('Existing configuration was reused.');
      }
    });
}
