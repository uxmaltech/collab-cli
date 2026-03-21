import fs from 'node:fs';
import path from 'node:path';

import type { Command } from 'commander';

import { createBirthDraftAssistant } from '../../lib/agent-bootstrap/chat';
import { clearBirthWizardDraft } from '../../lib/agent-bootstrap/draft-state';
import {
  createBornAgentRecord,
  saveBornAgent,
} from '../../lib/agent-registry';
import {
  hydrateAgentBootstrapEnv,
  loadExistingAgentBootstrapInput,
} from '../../lib/agent-bootstrap/existing-state';
import { createCommandContext } from '../../lib/command-context';
import {
  AGENT_BOOTSTRAP_FORCE_MODES,
} from '../../lib/agent-bootstrap/types';
import {
  generateAgentBootstrap,
  summarizeAgentBootstrap,
} from '../../lib/agent-bootstrap/generate';
import { normalizeAgentBootstrapOptions } from '../../lib/agent-bootstrap/normalize';
import { mergeBirthProfileFields } from '../../lib/agent-bootstrap/profile';
import {
  collectAgentBirthInteractiveInput,
  shouldRunBirthWizard,
} from '../../lib/agent-bootstrap/wizard';
import { formatForceModeList } from '../../lib/force-mode';
import { writeAgentBootstrapFiles } from '../../lib/agent-bootstrap/write';
import type { AgentBootstrapInput } from '../../lib/agent-bootstrap/types';
import type { AgentBootstrapCommandOptions } from './types';

function appendStringOption(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function printJsonSummary(summary: ReturnType<typeof summarizeAgentBootstrap>): void {
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}

function resolveAgentControlWorkspaceDir(
  cwd: string,
  outputDir: string,
  outputHadExistingAgentConfig: boolean,
): string {
  const resolvedCwd = path.resolve(cwd);
  const resolvedOutputDir = path.resolve(outputDir);

  if (
    resolvedCwd === resolvedOutputDir
    && outputHadExistingAgentConfig
  ) {
    return path.dirname(resolvedOutputDir);
  }

  return resolvedCwd;
}

function getCliOptionValue<T>(
  command: Command,
  optionName: string,
  value: T | undefined,
): T | undefined {
  const source =
    typeof command.getOptionValueSource === 'function'
      ? command.getOptionValueSource(optionName)
      : undefined;

  return source === 'cli' ? value : undefined;
}

function mergeBootstrapInput(
  existing: Partial<AgentBootstrapInput>,
  current: AgentBootstrapInput,
): AgentBootstrapInput {
  const merged: AgentBootstrapInput = {
    ...existing,
    cwd: current.cwd,
    birthProfile: {
      ...(existing.birthProfile ?? {}),
      ...(current.birthProfile ?? {}),
    },
  };

  for (const [key, value] of Object.entries(current) as Array<
    [keyof AgentBootstrapInput, AgentBootstrapInput[keyof AgentBootstrapInput]]
  >) {
    if (key === 'birthProfile' || key === 'egressUrl' || value === undefined) {
      continue;
    }

    ((merged as unknown) as Record<string, unknown>)[key] = value;
  }

  if (current.egressUrl !== undefined) {
    merged.egressUrl = current.egressUrl.length > 0 ? current.egressUrl : existing.egressUrl;
  } else if (existing.egressUrl !== undefined) {
    merged.egressUrl = existing.egressUrl;
  }

  return merged;
}

export function registerAgentBootstrapCommand(program: Command): void {
  program
    .command('bootstrap')
    .alias('birth')
    .description('Generate the canonical Collab agent birth package for a workspace')
    .option('--agent-name <name>', 'Display name for the agent')
    .option('--agent-slug <slug>', 'Filesystem-safe slug for the agent')
    .option('--agent-id <id>', 'Stable agent identifier')
    .option('--scope <scope>', 'Primary scope handled by the agent')
    .option('--provider <provider>', 'Default assistant provider to enable')
    .option('--provider-auth <method>', 'Provider auth method: api-key|cli')
    .option('--model <model>', 'Default model for api-key providers; CLI transports use their own configuration')
    .option('--operator-id <id>', 'Stable operator identifiers, comma-separated with the primary operator first')
    .option('--github-app-id <id>', 'GitHub App id used by the born agent')
    .option('--github-app-installation-id <id>', 'GitHub App installation id used by the born agent')
    .option('--github-app-owner <owner>', 'GitHub App owner login used by the born agent')
    .option('--github-app-owner-type <type>', 'GitHub App owner type: auto|org|user')
    .option('--github-app-private-key-path <path>', 'Path to the GitHub App private key PEM for the born agent')
    .option('--telegram-bot-token <token>', 'Telegram bot token used by the born agent')
    .option('--telegram-default-chat-id <id>', 'Telegram chat id for team summaries; requires --telegram-thread-id')
    .option('--telegram-thread-id <id>', 'Telegram thread id used for team summaries')
    .option('--telegram-allow-topic-commands', 'Allow the configured Telegram thread to accept commands from operators')
    .option('--telegram-webhook-public-base-url <url>', 'Public base URL that Telegram will call for webhook delivery')
    .option('--telegram-webhook-secret <token>', 'Optional Telegram webhook secret token')
    .option('--telegram-webhook-bind-host <host>', 'Local bind host for the Telegram webhook server')
    .option('--telegram-webhook-port <port>', 'Local port for the Telegram webhook server')
    .option('--cognitive-mcp-url <url>', 'Cognitive MCP endpoint used by the generated scaffold')
    .option('--redis-url <url>', 'Redis URL used by the generated scaffold')
    .option(
      '--self-repository <slug>',
      'Repository slug where this agent lives and evolves',
    )
    .option(
      '--assigned-repositories <list>',
      'Comma-separated repository slugs assigned to this agent for work',
    )
    .option(
      '--approved-namespaces <list>',
      'Comma-separated namespaces approved for the worker profile',
    )
    .option(
      '--egress-url <url>',
      'Repeatable egress allow entry; use \'*\' to allow all destinations',
      appendStringOption,
      [],
    )
    .option('--output <directory>', 'Output directory for the generated birth package')
    .option('--force <mode>', `Force mode: ${formatForceModeList(AGENT_BOOTSTRAP_FORCE_MODES)}`)
    .option('--json', 'Print a machine-readable summary after generation')
    .option('--interactive', 'Run the birth wizard even when flags are provided')
    .option('--no-interactive', 'Disable the birth wizard and use flags/defaults only')
    .option('--no-telemetry', 'Disable telemetry in the generated config')
    .option('--no-operator-profile', 'Mark the operator profile as disabled in config')
    .addHelpText(
      'after',
      `
Examples:
  collab agent birth
  collab agent bootstrap --agent-name "Collab Architect"
  collab agent birth --agent-name "Collab Architect" --provider gemini --model gemini-2.5-pro
  collab agent birth --provider codex --provider-auth cli
  collab agent birth --agent-name "Collab Architect" --operator-id operator.telegram.130149339 --telegram-bot-token "$TELEGRAM_BOT_TOKEN"
  collab agent bootstrap --output ./my-agent --self-repository anystream/iot-development-agent
  collab agent bootstrap --output ./qa-agent --assigned-repositories org/repo-a,org/repo-b
  collab agent bootstrap --cognitive-mcp-url http://localhost:8787/mcp --egress-url '*'
  collab agent birth --output ./iot-agent --force overwrite
  collab agent birth --output ./iot-agent --force rebirth
`,
    )
    .action(async (options: AgentBootstrapCommandOptions, command: Command) => {
      const context = createCommandContext(command);
      const isInteractiveSession = Boolean(process.stdin.isTTY && process.stdout.isTTY);
      const baseInput = {
        cwd: context.cwd,
        agentName: getCliOptionValue(command, 'agentName', options.agentName),
        agentSlug: getCliOptionValue(command, 'agentSlug', options.agentSlug),
        agentId: getCliOptionValue(command, 'agentId', options.agentId),
        scope: getCliOptionValue(command, 'scope', options.scope),
        provider: getCliOptionValue(command, 'provider', options.provider),
        providerAuthMethod: getCliOptionValue(command, 'providerAuth', options.providerAuth),
        model: getCliOptionValue(command, 'model', options.model),
        operatorId: getCliOptionValue(command, 'operatorId', options.operatorId),
        githubAppId: getCliOptionValue(command, 'githubAppId', options.githubAppId),
        githubAppInstallationId: getCliOptionValue(
          command,
          'githubAppInstallationId',
          options.githubAppInstallationId,
        ),
        githubAppOwner: getCliOptionValue(command, 'githubAppOwner', options.githubAppOwner),
        githubAppOwnerType: getCliOptionValue(
          command,
          'githubAppOwnerType',
          options.githubAppOwnerType,
        ),
        githubAppPrivateKeyPath: getCliOptionValue(
          command,
          'githubAppPrivateKeyPath',
          options.githubAppPrivateKeyPath,
        ),
        telegramBotToken: getCliOptionValue(
          command,
          'telegramBotToken',
          options.telegramBotToken,
        ),
        telegramDefaultChatId: getCliOptionValue(
          command,
          'telegramDefaultChatId',
          options.telegramDefaultChatId,
        ),
        telegramThreadId: getCliOptionValue(
          command,
          'telegramThreadId',
          options.telegramThreadId,
        ),
        telegramAllowTopicCommands: getCliOptionValue(
          command,
          'telegramAllowTopicCommands',
          options.telegramAllowTopicCommands,
        ),
        telegramWebhookPublicBaseUrl: getCliOptionValue(
          command,
          'telegramWebhookPublicBaseUrl',
          options.telegramWebhookPublicBaseUrl,
        ),
        telegramWebhookSecret: getCliOptionValue(
          command,
          'telegramWebhookSecret',
          options.telegramWebhookSecret,
        ),
        telegramWebhookBindHost: getCliOptionValue(
          command,
          'telegramWebhookBindHost',
          options.telegramWebhookBindHost,
        ),
        telegramWebhookPort: getCliOptionValue(
          command,
          'telegramWebhookPort',
          options.telegramWebhookPort,
        ),
        cognitiveMcpUrl: getCliOptionValue(command, 'cognitiveMcpUrl', options.cognitiveMcpUrl),
        redisUrl: getCliOptionValue(command, 'redisUrl', options.redisUrl),
        selfRepository: getCliOptionValue(command, 'selfRepository', options.selfRepository),
        assignedRepositories: getCliOptionValue(
          command,
          'assignedRepositories',
          options.assignedRepositories,
        ),
        approvedNamespaces: getCliOptionValue(
          command,
          'approvedNamespaces',
          options.approvedNamespaces,
        ),
        egressUrl: getCliOptionValue(command, 'egressUrl', options.egressUrl),
        output: getCliOptionValue(command, 'output', options.output),
        forceMode: getCliOptionValue(command, 'force', options.force),
        json: getCliOptionValue(command, 'json', options.json),
        interactive: getCliOptionValue(command, 'interactive', options.interactive),
        telemetryEnabled: getCliOptionValue(command, 'telemetry', options.telemetry),
        operatorProfileEnabled: getCliOptionValue(
          command,
          'operatorProfile',
          options.operatorProfile,
        ),
      };
      const outputDir = path.resolve(context.cwd, baseInput.output ?? '.');
      const existingInput =
        baseInput.forceMode === 'rebirth'
          ? {}
          : loadExistingAgentBootstrapInput(outputDir);
      hydrateAgentBootstrapEnv(outputDir);
      const seededInput = mergeBootstrapInput(existingInput, baseInput);

      const input = shouldRunBirthWizard(seededInput, {
        isInteractiveSession,
      })
        ? await collectAgentBirthInteractiveInput(seededInput, {
            logger: context.logger,
            isInteractiveSession: true,
            dryRun: context.dryRun,
            wizardMode: 'auto',
          })
        : seededInput;

      const draftSeed = normalizeAgentBootstrapOptions(input);
      let birthProfile = draftSeed.birthProfile;

      try {
        const birthDraft = await createBirthDraftAssistant(context.logger, {
          interactiveSession: isInteractiveSession && input.interactive !== false && !input.json,
        }).draftProfile(draftSeed);
        if (birthDraft) {
          birthProfile = mergeBirthProfileFields(draftSeed.birthProfile, birthDraft);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        context.logger.warn(`Birth draft assistant failed, using deterministic defaults. ${message}`);
      }

      const result = generateAgentBootstrap({
        ...input,
        birthProfile,
      });
      const outputHadExistingAgentConfig = fs.existsSync(
        path.join(result.options.outputDir, '.collab', 'config.json'),
      );

      writeAgentBootstrapFiles(context.executor, result.files, {
        overwriteExistingManagedFiles: result.options.overwriteExistingManagedFiles,
      });
      if (!context.dryRun) {
        const controlWorkspaceDir = resolveAgentControlWorkspaceDir(
          context.cwd,
          result.options.outputDir,
          outputHadExistingAgentConfig,
        );
        saveBornAgent(
          controlWorkspaceDir,
          createBornAgentRecord(result.options, controlWorkspaceDir),
        );
        clearBirthWizardDraft(result.options.outputDir);
      }

      const summary = summarizeAgentBootstrap(result);

      if (result.options.json) {
        printJsonSummary(summary);
        return;
      }

      for (const file of result.files) {
        context.logger.info(`${context.dryRun ? 'plan' : 'wrote'} ${file.relativePath}`);
      }

      context.logger.result(
        `${context.dryRun ? 'Planned' : 'Created'} agent birth package for ${result.options.agentName}`,
      );
      context.logger.summaryFooter([
        { label: 'output', value: result.options.outputDir },
        {
          label: 'provider',
          value: result.options.model
            ? `${result.options.provider} via ${result.options.providerAuthMethod} (${result.options.model})`
            : `${result.options.provider} via ${result.options.providerAuthMethod}`,
        },
        { label: 'files', value: String(result.files.length) },
      ]);
    });
}
