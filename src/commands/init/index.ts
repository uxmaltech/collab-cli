import fs from 'node:fs';

import { Command } from 'commander';

import { createCommandContext } from '../../lib/command-context';
import {
  defaultCollabConfig,
  resolveRepoConfigs,
} from '../../lib/config';
import { CliError } from '../../lib/errors';
import { loadGitHubAuth } from '../../lib/github-auth';
import { validateWorkspaceRepos } from '../../lib/github-api';
import { runOrchestration, runPerRepoOrchestration } from '../../lib/orchestrator';
import { ensureWritableDirectory } from '../../lib/preconditions';
import { getEnabledProviders, PROVIDER_DEFAULTS } from '../../lib/providers';
import { readCliVersion } from '../../lib/version';

import type { InitOptions } from './types';
import { runEcosystemChecks } from './mcp-helpers';
import { resolveWizardSelection } from './wizard';
import { resolveBusinessCanon, cloneGitHubRepo, ensureGitHubAuth } from './business-canon';
import { resolveWorkspace } from './workspace';
import { runInfraOnly } from './infra-only';
import { runGitHubWorkflow } from './github-workflow';
import { runReposDomainGeneration } from './repos';
import {
  buildWorkspaceStages,
  buildPerRepoStages,
  buildInfraStages,
  buildRemoteInfraStages,
  buildFileOnlyPipeline,
} from './pipelines';

export function registerInitCommand(program: Command): void {
  const init = program
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
    .option('--repo <package>', '(deprecated, use "collab init repos <path>") Generate domain definition')
    .option('--skip-mcp-snippets', 'Skip MCP client config snippet generation')
    .option('--skip-analysis', 'Skip AI-powered repository analysis (codex/claude/gemini)')
    .option('--skip-ci', 'Skip GitHub Actions CI workflow generation')
    .option('--skip-github-setup', 'Skip GitHub branch model and workflow configuration')
    .option('--skip-ingest', 'Skip entire repo-ingest stage (no AST extraction, no MCP ingestion)')
    .option('--skip-ast-generation', 'Skip tree-sitter AST extraction (documents still chunked and ingested)')
    .option('--skip-ast-delta', 'Skip generating the AST delta PR workflow (ast-delta-pr.yml)')
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
  collab init repos collab-chat-ai-pkg --mode file-only --yes --business-canon none
  collab init repos pkg-a pkg-b --mode indexed --business-canon owner/repo
  collab init --yes --mode indexed --infra-type remote --mcp-url http://my-server:7337 --business-canon none
  collab init --resume
  collab init infra
  collab init infra --resume
  collab init github-workflow
  collab init github-workflow --dry-run
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

      // ── Deprecated --repo flag redirect ─────────────────────
      if (options.repo) {
        context.logger.warn(
          'The --repo flag is deprecated and will be removed in a future release. ' +
            'Use "collab init repos <path>" instead.',
        );
        await runReposDomainGeneration(context, options, [options.repo]);
        return;
      }

      // ── Full wizard flow ────────────────────────────────────
      const configExistedBefore = fs.existsSync(context.config.configFile);

      if (options.force) {
        context.logger.warn('Force mode enabled: configuration will be overwritten with wizard selections.');
      }

      const version = readCliVersion();
      context.logger.wizardIntro(`collab init v${version}`);

      // ── Step 1: Configuration wizard ────────────────────────
      let wizStep = 0;
      context.logger.wizardStep(++wizStep, 'Configuration');

      const selections = await resolveWizardSelection(
        options, context.config, context.logger, context.executor.dryRun,
      );
      const preserveExisting = configExistedBefore && !options.force;

      const effectiveConfig = {
        ...defaultCollabConfig(context.config.workspaceDir),
        ...context.config,
        mode: preserveExisting ? context.config.mode : selections.mode,
        infraType: preserveExisting ? context.config.infraType : selections.infraType,
        mcpUrl: preserveExisting ? context.config.mcpUrl : selections.mcpUrl,
      };

      // ── Step 2: Business canon configuration ──────────────────
      if (!preserveExisting) {
        context.logger.wizardStep(++wizStep, 'Business Canon');

        const canons = await resolveBusinessCanon(options, effectiveConfig, context.logger);
        if (canons) {
          effectiveConfig.canons = canons;

          // Non-interactive path: resolveBusinessCanon only returns config
          // when --business-canon is passed via CLI. Clone it now so workspace
          // detection finds the repo. The interactive path already clones inside
          // resolveGitHubBusinessCanon.
          if (
            options.businessCanon
            && canons.business?.source === 'github'
            && !context.executor.dryRun
          ) {
            const token = options.githubToken
              ?? (await ensureGitHubAuth(effectiveConfig.collabDir, context.logger));
            await cloneGitHubRepo(
              canons.business.repo,
              canons.business.branch,
              effectiveConfig.workspaceDir,
              token,
              context.logger,
            );
          }
        }
      }

      const stageOptions: Record<string, unknown> = {
        yes: options.yes,
        providers: options.providers,
        outputDir: options.outputDir,
        skipAnalysis: options.skipAnalysis,
        skipCi: options.skipCi,
        skipGithubSetup: options.skipGithubSetup,
        skipAstDelta: options.skipAstDelta,
      };

      // ── Workspace detection ───────────────────────────────────
      // Derive business canon directory name so it can be excluded
      // from the governed repos list (it is managed separately).
      const businessCanonSlug = effectiveConfig.canons?.business?.source === 'github'
        ? effectiveConfig.canons.business.repo
        : undefined;
      const businessCanonDir = businessCanonSlug?.split('/').pop();

      const ws =
        !options.force && !options.repos && context.config.workspace
          ? context.config.workspace
          : await resolveWorkspace(
              context.config.workspaceDir,
              effectiveConfig.collabDir,
              options,
              context.logger,
              selections.mode,
              businessCanonDir,
            );

      if (ws) {
        // ── WORKSPACE MODE ────────────────────────────────────
        effectiveConfig.workspace = { name: ws.name, type: ws.type, repos: ws.repos };
        effectiveConfig.compose = {
          ...effectiveConfig.compose,
          projectName: `collab-${ws.name}`,
        };

        context.logger.wizardStep(++wizStep, 'Workspace Setup', `${ws.repos.length} repositories (${ws.type})`);

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

        // ── Indexed mode: validate repos ──
        if (selections.mode === 'indexed' && context.executor.dryRun) {
          context.logger.info('[dry-run] Would validate GitHub remotes and token access for workspace repos.');
        } else if (selections.mode === 'indexed') {
          context.logger.wizardStep(++wizStep, 'Repository Validation', 'GitHub access');
          const auth = loadGitHubAuth(effectiveConfig.collabDir);
          if (!auth) {
            throw new CliError(
              'GitHub authorization required but token not found after auth stage.',
            );
          }

          const validRepos = await validateWorkspaceRepos(
            ws.repos, effectiveConfig.workspaceDir, auth.token, context.logger,
          );
          effectiveConfig.workspace = { ...effectiveConfig.workspace, repos: validRepos };
          ws.repos = validRepos;
        }

        // Phase R — per-repo stages
        const repoConfigs = resolveRepoConfigs(effectiveConfig);
        context.logger.wizardStep(++wizStep, 'Repository Setup', `${selections.mode} mode`);

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
          context.logger.wizardStep(++wizStep, 'Infrastructure', infraLabel);

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
        // ── SINGLE-REPO MODE ─────────────────────────────────
        if (selections.mode === 'indexed') {
          throw new CliError(
            'Indexed mode requires a multi-repo workspace.\n' +
              'Run from a workspace directory with multiple git repos, or use --repos to specify repos.',
          );
        }

        context.logger.wizardStep(++wizStep, 'Project Setup', selections.mode);

        const stages = buildFileOnlyPipeline(
          effectiveConfig, context.executor, context.logger, configExistedBefore, options,
        );

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

      await runEcosystemChecks(effectiveConfig, context.logger, context.executor.dryRun);

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
        context.logger.info('      collab init repos <package-name>');
      }

      context.logger.info('  - Verify full setup health:');
      context.logger.info('      collab doctor');

      if (!options.force && configExistedBefore) {
        context.logger.debug('Existing configuration was reused.');
      }

      context.logger.wizardOutro('Setup complete');
    });

  // ── Register subcommands ────────────────────────────────
  registerReposSubcommand(init);
  registerGitHubWorkflowSubcommand(init);
}

// ────────────────────────────────────────────────────────────────
// Subcommand: collab init repos <path...>
// ────────────────────────────────────────────────────────────────

function registerReposSubcommand(init: Command): void {
  init
    .command('repos')
    .description('Generate domain definitions from one or more package repositories')
    .argument('<paths...>', 'One or more repository paths to analyze')
    .addHelpText(
      'after',
      `
Options are inherited from "collab init" (--mode, --yes, --business-canon, etc.)

Examples:
  collab init repos collab-chat-ai-pkg
  collab init repos pkg-a pkg-b pkg-c --mode file-only --yes --business-canon none
  collab init repos ./path/to/repo --mode indexed --business-canon owner/repo
`,
    )
    .action(async (paths: string[], _options: InitOptions, command: Command) => {
      const context = createCommandContext(command);
      ensureWritableDirectory(context.config.workspaceDir);

      // Options are defined on the parent "init" command, so we read them
      // via optsWithGlobals() which merges parent + root-level options.
      const parentOptions = command.optsWithGlobals<InitOptions>();

      await runReposDomainGeneration(context, parentOptions, paths);
    });
}

// ────────────────────────────────────────────────────────────────
// Subcommand: collab init github-workflow
// ────────────────────────────────────────────────────────────────

function registerGitHubWorkflowSubcommand(init: Command): void {
  init
    .command('github-workflow')
    .description('Configure GitHub branch model, protections, and CI workflows')
    .addHelpText(
      'after',
      `
Options are inherited from "collab init" (--mode, --skip-ci, --skip-github-setup, --github-token, etc.)

Requires an existing .collab/config.json (run "collab init" first).

Stages:
  1. github-auth     — resolve/validate GitHub token
  2. github-setup    — branch model, protection, guard-main-pr.yml, canon-sync-trigger.yml (indexed only)
  3. ci-setup        — architecture-pr.yml (both modes), architecture-merge.yml (indexed only)

Examples:
  collab init github-workflow
  collab init github-workflow --dry-run
  collab init github-workflow --skip-github-setup
  collab init github-workflow --skip-ci
  collab init github-workflow --github-token ghp_xxxxx
`,
    )
    .action(async (_options: InitOptions, command: Command) => {
      const context = createCommandContext(command);
      const parentOptions = command.optsWithGlobals<InitOptions>();
      await runGitHubWorkflow(context, parentOptions);
    });
}
