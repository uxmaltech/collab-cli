import fs from 'node:fs';
import path from 'node:path';

import { Command } from 'commander';

import { createCommandContext } from '../lib/command-context';
import { assertComposeFilesValid } from '../lib/compose-validator';
import {
  defaultCollabConfig,
  discoverRepos,
  isWorkspaceRoot,
  resolveRepoConfigs,
  serializeUserConfig,
  type CollabConfig,
} from '../lib/config';
import { checkEcosystemCompatibility } from '../lib/ecosystem';
import { generateComposeFiles } from '../lib/compose-renderer';
import { CliError } from '../lib/errors';
import { parseMode, type CollabMode } from '../lib/mode';
import { runOrchestration, runPerRepoOrchestration, type OrchestrationStage } from '../lib/orchestrator';
import { promptChoice, promptMultiSelect } from '../lib/prompt';
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
import { getEnabledProviders, PROVIDER_DEFAULTS, type ProviderKey } from '../lib/providers';
import type { Executor } from '../lib/executor';
import type { Logger } from '../lib/logger';

interface InitOptions {
  force?: boolean;
  yes?: boolean;
  resume?: boolean;
  mode?: string;
  composeMode?: string;
  outputDir?: string;
  repos?: string;
  skipMcpSnippets?: boolean;
  skipAnalysis?: boolean;
  skipCi?: boolean;
  timeoutMs?: string;
  retries?: string;
  retryDelayMs?: string;
  providers?: string;
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

function parseRepos(value: string | undefined): string[] | null {
  if (!value) return null;
  return value.split(',').map((r) => r.trim()).filter(Boolean);
}

async function resolveWorkspaceRepos(
  workspaceDir: string,
  options: InitOptions,
  logger: Logger,
): Promise<string[] | null> {
  // Explicit --repos flag takes priority
  const explicit = parseRepos(options.repos);
  if (explicit && explicit.length > 0) {
    logger.info(`Workspace mode: ${explicit.length} repo(s) specified: ${explicit.join(', ')}`);
    return explicit;
  }

  // Auto-discover when cwd looks like a workspace root
  if (isWorkspaceRoot(workspaceDir)) {
    const discovered = discoverRepos(workspaceDir);

    if (options.yes) {
      logger.info(`Workspace auto-detected: ${discovered.length} repo(s) found: ${discovered.join(', ')}`);
      return discovered;
    }

    // Interactive: let user confirm/select repos
    const selected = await promptMultiSelect(
      'This directory contains multiple git repositories. Select repos to include:',
      discovered.map((r) => ({ value: r, label: r })),
      discovered,
    );

    return selected.length > 0 ? selected : null;
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
    assistantSetupStage,                                       // 3
    canonSyncStage,                                            // 4
    repoScaffoldStage,                                         // 5
    repoAnalysisFileOnlyStage,                                 // 6
    ciSetupStage,                                              // 7
    agentSkillsSetupStage,                                     // 8
  ];
}

// ────────────────────────────────────────────────────────────────
// Indexed pipeline (14 stages)
// ────────────────────────────────────────────────────────────────

function buildIndexedPipeline(
  effectiveConfig: CollabConfig,
  executor: Executor,
  logger: Logger,
  configExistedBefore: boolean,
  options: InitOptions,
  composeMode: ComposeMode,
): OrchestrationStage[] {
  const health = {
    timeoutMs: toNumber(options.timeoutMs, 5_000),
    retries: toNumber(options.retries, 15),
    retryDelayMs: toNumber(options.retryDelayMs, 2_000),
  };

  return [
    // Phase A — Local setup (shared with file-only)
    buildPreflightStage(executor, logger),                     // 1
    buildConfigStage(effectiveConfig, executor, logger,
      configExistedBefore, options.force),                     // 2
    assistantSetupStage,                                       // 3
    canonSyncStage,                                            // 4
    repoScaffoldStage,                                         // 5
    repoAnalysisStage,                                         // 6
    ciSetupStage,                                              // 7
    agentSkillsSetupStage,                                     // 8

    // Phase B — Infrastructure
    {                                                          // 9
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
    {                                                          // 10
      id: 'infra-start',
      title: 'Start infrastructure services',
      recovery: [
        'Run collab infra status to inspect Qdrant and Nebula.',
        'Run collab init --resume after infra services are healthy.',
      ],
      run: async () => {
        const selection = resolveInfraComposeFile(effectiveConfig, options.outputDir, undefined);
        await runInfraCompose(logger, executor, effectiveConfig, selection, 'up', { health });
      },
    },
    {                                                          // 11
      id: 'mcp-start',
      title: 'Start MCP service',
      recovery: [
        'Run collab mcp status to inspect MCP runtime.',
        'Run collab init --resume after MCP health endpoint responds.',
      ],
      run: async () => {
        const selection = resolveMcpComposeFile(effectiveConfig, options.outputDir, undefined);
        await runMcpCompose(logger, executor, effectiveConfig, selection, 'up', { health });
      },
    },
    {                                                          // 12
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
          if (!snippet) {
            continue;
          }
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

    // Phase C — Ingestion
    graphSeedStage,                                            // 13
    canonIngestStage,                                          // 14
  ];
}

// ────────────────────────────────────────────────────────────────
// Command registration
// ────────────────────────────────────────────────────────────────

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Run onboarding wizard and orchestrate setup stages')
    .option('-f, --force', 'Overwrite existing .collab/config.json with new wizard selection')
    .option('--yes', 'Accept wizard defaults and run non-interactively')
    .option('--resume', 'Resume from the last incomplete wizard stage')
    .option('--mode <mode>', 'Wizard mode: file-only|indexed')
    .option('--compose-mode <mode>', 'Compose mode: consolidated|split')
    .option('--output-dir <directory>', 'Directory used to write compose outputs')
    .option('--repos <list>', 'Comma-separated repo directories for workspace mode')
    .option('--skip-mcp-snippets', 'Skip MCP client config snippet generation')
    .option('--skip-analysis', 'Skip AI-powered repository analysis stage')
    .option('--skip-ci', 'Skip CI workflow generation')
    .option('--providers <list>', 'Comma-separated AI provider list (codex,claude,gemini,copilot)')
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
  collab init --resume
`,
    )
    .action(async (options: InitOptions, command: Command) => {
      const context = createCommandContext(command);
      ensureWritableDirectory(context.config.workspaceDir);
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

      const stageOptions: Record<string, unknown> = {
        yes: options.yes,
        providers: options.providers,
        outputDir: options.outputDir,
        skipAnalysis: options.skipAnalysis,
        skipCi: options.skipCi,
      };

      // ── Workspace detection ───────────────────────────────────
      const repos = await resolveWorkspaceRepos(
        context.config.workspaceDir,
        options,
        context.logger,
      );

      if (repos && repos.length > 0) {
        // ── WORKSPACE MODE ────────────────────────────────────
        effectiveConfig.workspace = { repos };
        const repoConfigs = resolveRepoConfigs(effectiveConfig);

        // Phase W — workspace-level stages
        context.logger.phaseHeader('Workspace Setup', `${repos.length} repositories`);

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

      if (repos && repos.length > 0) {
        summaryEntries.splice(1, 0, { label: 'Workspace repos', value: repos.join(', ') });
      }

      if (selections.mode === 'indexed') {
        summaryEntries.splice(repos ? 2 : 1, 0, { label: 'Compose mode', value: selections.composeMode });
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
