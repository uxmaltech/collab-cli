import readline from 'node:readline/promises';
import path from 'node:path';

import {
  createBirthInterviewAssistant,
  type BirthInterviewAssistant,
  type BirthInterviewCapture,
  type BirthInterviewMessage,
} from './chat';
import { detectProviderCli, type CliInfo } from '../cli-detection';
import type { Logger } from '../logger';
import { promptChoice, promptMultiSelect, promptText } from '../prompt';
import { PROVIDER_DEFAULTS, PROVIDER_KEYS, type AuthMethod, type ProviderKey } from '../providers';
import {
  DEFAULT_MCP_URL,
  DEFAULT_REDIS_URL,
  DEFAULT_WORKER_NAMESPACES,
  defaultEgressUrls,
  humanizeAgentSlug,
  parseCsvList,
  slugifyAgentName,
} from './defaults';
import {
  buildBirthWizardDraftPath,
  clearBirthWizardDraft,
  loadBirthWizardDraft,
  saveBirthWizardDraft,
  type AgentBirthWizardDraftAnswers,
} from './draft-state';
import {
  extractGitHubRepositoryReferences,
  pickBirthRepositoriesFromGitHub,
  type BirthRepositorySelection,
  validateGitHubRepositoryReferences,
} from './github-repositories';
import {
  GitHubAppValidationError,
  type ValidateGitHubAppIdentityResult,
  validateGitHubAppIdentity,
} from './github-app';
import {
  discoverTelegramTargets,
  resolveTelegramRouting,
  tryAutoResolveTelegramRouting,
  type TelegramDiscoveryResult,
  type TelegramRouting,
} from './telegram';
import {
  prevalidateBirthWizardMode,
  type BirthWizardPrevalidation,
} from './env-taxonomy';
import type { AgentBootstrapInput } from './types';
import { bold, cyan, dim, green, red, yellow } from '../ansi';

export interface BirthPromptAdapter {
  text(question: string, defaultValue?: string): Promise<string>;
  choice<T extends string>(
    question: string,
    choices: Array<{ value: T; label: string; description?: string }>,
    defaultValue: T,
  ): Promise<T>;
  multiSelect<T extends string>(
    question: string,
    choices: Array<{ value: T; label: string; description?: string }>,
    defaults?: readonly T[],
  ): Promise<T[]>;
}

export interface BirthRepositoryPicker {
  pickRepositories(): Promise<BirthRepositorySelection>;
}

export interface BirthWizardDependencies {
  logger: Logger;
  prompt: BirthPromptAdapter;
  isInteractiveSession: boolean;
  dryRun: boolean;
  collabDir: string;
  repositoryPicker: BirthRepositoryPicker;
  providerCliResolver: (provider: ProviderKey) => CliInfo;
  wizardMode: 'structured' | 'auto';
  wizardPrevalidationResolver: (preferredProvider: ProviderKey) => BirthWizardPrevalidation;
  conversationAssistant: BirthInterviewAssistant;
  githubAppValidator: (
    input: Parameters<typeof validateGitHubAppIdentity>[0],
  ) => Promise<ValidateGitHubAppIdentityResult>;
}

interface BirthWizardPromptState {
  question: string;
  details: string[];
  defaultValue?: string;
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, '');
}

function wrapTerminalLine(text: string, width: number): string[] {
  const cleanWidth = Math.max(width, 20);
  const words = text.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) {
    return [''];
  }

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current.length > 0 ? `${current} ${word}` : word;
    if (stripAnsi(candidate).length <= cleanWidth) {
      current = candidate;
      continue;
    }

    if (current.length > 0) {
      lines.push(current);
    }
    current = word;
  }

  if (current.length > 0) {
    lines.push(current);
  }

  return lines;
}

class BirthWizardTerminalUi {
  private title = 'collab agent birth';
  private stepTitle?: string;
  private stepSubtitle?: string;
  private stepNumber?: number;
  private latestThought?: { provider: string; title: string; body?: string };
  private latestInterview?: { provider: string; message: string };
  private promptState?: BirthWizardPromptState;
  private statusLines: Array<{ level: 'info' | 'warn' | 'error' | 'debug'; text: string }> = [];
  private active = false;
  private readonly input = process.stdin;
  private readonly output = process.stdout;

  start(): void {
    if (this.active || !this.output.isTTY) {
      return;
    }

    this.active = true;
    this.output.write('\x1b[?1049h\x1b[2J\x1b[H');
    this.render();
  }

  stop(): void {
    if (!this.active || !this.output.isTTY) {
      return;
    }

    this.output.write('\x1b[?1049l');
    this.active = false;
  }

  setTitle(title: string): void {
    this.title = title;
    this.render();
  }

  setStep(current: number, title: string, subtitle?: string): void {
    this.stepNumber = current;
    this.stepTitle = title;
    this.stepSubtitle = subtitle;
    this.render();
  }

  setThought(provider: string, title: string, body?: string): void {
    this.latestThought = { provider, title, body };
    this.render();
  }

  setInterview(provider: string, message: string): void {
    this.latestInterview = { provider, message };
    this.render();
  }

  setPrompt(promptState: BirthWizardPromptState | undefined): void {
    this.promptState = promptState;
    this.render();
  }

  pushStatus(level: 'info' | 'warn' | 'error' | 'debug', text: string): void {
    this.statusLines.push({ level, text });
    if (this.statusLines.length > 4) {
      this.statusLines = this.statusLines.slice(-4);
    }
    this.render();
  }

  createLogger(baseLogger?: Logger): Logger {
    const ui = this;

    return {
      verbosity: baseLogger?.verbosity ?? 'normal',
      info(message) {
        ui.pushStatus('info', message);
      },
      debug(message) {
        if ((baseLogger?.verbosity ?? 'normal') === 'verbose') {
          ui.pushStatus('debug', message);
        }
      },
      warn(message) {
        ui.pushStatus('warn', message);
      },
      error(message) {
        ui.pushStatus('error', message);
      },
      result(message) {
        ui.pushStatus('info', message);
      },
      assistantThought(provider, title, body) {
        if ((baseLogger?.verbosity ?? 'normal') !== 'quiet') {
          ui.setThought(provider, title, body);
        }
      },
      assistantMessage(provider, message) {
        if ((baseLogger?.verbosity ?? 'normal') !== 'quiet') {
          ui.setInterview(provider, message);
        }
      },
      command(parts, options) {
        baseLogger?.command(parts, options);
      },
      stageHeader(index, total, title) {
        baseLogger?.stageHeader(index, total, title);
      },
      step(ok, message) {
        baseLogger?.step(ok, message);
      },
      workflowHeader(workflow, mode) {
        baseLogger?.workflowHeader(workflow, mode);
      },
      repoHeader(repoName, index, total) {
        baseLogger?.repoHeader(repoName, index, total);
      },
      phaseHeader(title, subtitle) {
        baseLogger?.phaseHeader(title, subtitle);
      },
      wizardStep(current, title, subtitle) {
        if ((baseLogger?.verbosity ?? 'normal') !== 'quiet') {
          ui.setStep(current, title, subtitle);
        }
      },
      wizardIntro(title) {
        if ((baseLogger?.verbosity ?? 'normal') !== 'quiet') {
          ui.setTitle(title);
        }
      },
      wizardOutro(message) {
        ui.pushStatus('info', message);
      },
      summaryFooter(entries) {
        baseLogger?.summaryFooter(entries);
      },
    };
  }

  createPromptAdapter(basePrompt: BirthPromptAdapter): BirthPromptAdapter {
    const ui = this;

    return {
      async text(question, defaultValue) {
        return ui.askText(question, defaultValue);
      },
      async choice(question, choices, defaultValue) {
        return ui.askChoice(question, choices, defaultValue);
      },
      async multiSelect(question, choices, defaults) {
        return basePrompt.multiSelect(question, choices, defaults);
      },
    };
  }

  private render(): void {
    if (!this.active || !this.output.isTTY) {
      return;
    }

    const width = Math.max((this.output.columns ?? 100) - 6, 40);
    const rows = this.output.rows ?? 30;
    const lines: string[] = [];

    lines.push(`  ${bold(cyan('\u250c'))}  ${bold(this.title)}`);
    lines.push('');
    if (this.stepTitle) {
      const subtitle = this.stepSubtitle ? ` ${dim('\u00b7')} ${dim(this.stepSubtitle)}` : '';
      lines.push(`  ${dim('\u2502')}`);
      lines.push(`  ${bold(cyan('\u25c6'))}  ${dim(`Step ${this.stepNumber ?? ''}`)} ${dim('\u00b7')} ${bold(this.stepTitle)}${subtitle}`.trimEnd());
      lines.push(`  ${dim('\u2502')}`);
      lines.push('');
    }

    const thoughtTitle = this.latestThought
      ? `${this.latestThought.provider} Thought · ${this.latestThought.title}`
      : 'Thought · Waiting for model reasoning';
    lines.push(`  ${bold(cyan(thoughtTitle))}`);
    const thoughtBodyLines = wrapTerminalLine(
      this.latestThought?.body ?? 'The latest thought block will stay here and update in place.',
      width,
    );
    for (const line of thoughtBodyLines) {
      lines.push(`  ${dim('\u2502')}  ${line}`);
    }
    lines.push('');

    const interviewTitle = this.latestInterview
      ? `${this.latestInterview.provider} Interview`
      : 'Wizard';
    lines.push(`  ${bold(green(interviewTitle))}`);
    const interviewBodyLines = wrapTerminalLine(
      this.latestInterview?.message ?? 'The active question will stay anchored below.',
      width,
    );
    for (const line of interviewBodyLines) {
      lines.push(`  ${dim('\u2502')}  ${line}`);
    }
    lines.push('');

    for (const status of this.statusLines) {
      const marker =
        status.level === 'warn'
          ? yellow('Warning')
          : status.level === 'error'
            ? red('Error')
            : status.level === 'debug'
              ? dim('Debug')
              : dim('Info');
      for (const line of wrapTerminalLine(`${stripAnsi(marker)}: ${status.text}`, width)) {
        lines.push(`  ${line}`);
      }
    }

    const promptLines: string[] = [];
    if (this.promptState) {
      promptLines.push('');
      promptLines.push(`  ${bold(green(this.promptState.question))}`);
      for (const detail of this.promptState.details) {
        for (const line of wrapTerminalLine(detail, width)) {
          promptLines.push(`  ${line}`);
        }
      }
      if (this.promptState.defaultValue && this.promptState.defaultValue.trim().length > 0) {
        promptLines.push(`  ${dim(`Default: ${this.promptState.defaultValue}`)}`);
      }
      promptLines.push('');
    }

    const reservedLines = promptLines.length + 1;
    const contentLines = lines.length;
    const padding = Math.max(rows - contentLines - reservedLines, 0);
    const frame = [...lines, ...Array.from({ length: padding }, () => ''), ...promptLines];

    this.output.write('\x1b[2J\x1b[H');
    this.output.write(frame.join('\n'));
    if (!frame.at(-1)?.endsWith('\n')) {
      this.output.write('\n');
    }
  }

  private async askText(question: string, defaultValue?: string): Promise<string> {
    this.setPrompt({
      question,
      details: [],
      defaultValue,
    });

    const rl = readline.createInterface({
      input: this.input,
      output: this.output,
    });

    try {
      const answer = await rl.question('  > ');
      return answer || defaultValue || '';
    } finally {
      rl.close();
      this.setPrompt(undefined);
    }
  }

  private async askChoice<T extends string>(
    question: string,
    choices: readonly { value: T; label: string; description?: string }[],
    defaultValue: T,
  ): Promise<T> {
    const defaultIndex = Math.max(
      choices.findIndex((choice) => choice.value === defaultValue),
      0,
    );

    while (true) {
      const details = choices.map((choice, index) => {
        const defaultMarker = index === defaultIndex ? ' (default)' : '';
        const description = choice.description ? ` — ${choice.description}` : '';
        return `${index + 1}. ${choice.label}${defaultMarker}${description}`;
      });

      this.setPrompt({
        question,
        details,
        defaultValue: String(defaultIndex + 1),
      });

      const rl = readline.createInterface({
        input: this.input,
        output: this.output,
      });

      try {
        const rawAnswer = (await rl.question('  > ')).trim();
        const answer = rawAnswer.length === 0 ? String(defaultIndex + 1) : rawAnswer;
        const numericIndex = Number(answer);

        if (Number.isInteger(numericIndex) && numericIndex >= 1 && numericIndex <= choices.length) {
          return choices[numericIndex - 1]!.value;
        }

        const matchedChoice = choices.find((choice) =>
          choice.value === answer
          || choice.label.toLowerCase() === answer.toLowerCase(),
        );

        if (matchedChoice) {
          return matchedChoice.value;
        }

        this.pushStatus('warn', `Invalid selection "${answer}". Choose a number or option value.`);
      } finally {
        rl.close();
        this.setPrompt(undefined);
      }
    }
  }
}

function hasExplicitBirthInputs(input: AgentBootstrapInput): boolean {
  return Boolean(
    input.agentName
      || input.agentSlug
      || input.agentId
      || input.scope
      || input.provider
      || input.model
      || input.operatorId
      || input.cognitiveMcpUrl
      || input.cognitiveMcpApiKey
      || input.redisUrl
      || input.redisPassword
      || input.approvedNamespaces
      || (input.egressUrl && input.egressUrl.length > 0)
      || input.telegramEnabled !== undefined
      || input.telegramBotToken
      || input.telegramDefaultChatId
      || input.telegramThreadId
      || input.selfRepository
      || input.assignedRepositories,
  );
}

export function shouldRunBirthWizard(
  input: AgentBootstrapInput,
  dependencies: Pick<BirthWizardDependencies, 'isInteractiveSession'>,
): boolean {
  if (input.interactive === false) {
    return false;
  }

  if (!dependencies.isInteractiveSession || input.json) {
    return false;
  }

  if (input.interactive === true) {
    return true;
  }

  if (input.forceMode === 'overwrite' || input.forceMode === 'rebirth') {
    return true;
  }

  return !hasExplicitBirthInputs(input);
}

function defaultPromptAdapter(): BirthPromptAdapter {
  return {
    text: promptText,
    choice: promptChoice,
    multiSelect: promptMultiSelect,
  };
}

function hasTextValue(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function resolveOperatorSeed(
  operatorId: string | undefined,
  agentSlug: string,
): {
  primaryOperatorId?: string;
  additionalOperatorIds: string;
  requiresPrompt: boolean;
} {
  const placeholderOperatorId = `operator.${agentSlug}`;
  const configuredOperatorIds = parseCsvList(operatorId);
  const nonPlaceholderOperatorIds = configuredOperatorIds.filter(
    (value) => value !== placeholderOperatorId,
  );
  const hasExplicitPrimaryOperator =
    configuredOperatorIds.length > 0 && configuredOperatorIds[0] !== placeholderOperatorId;

  return {
    primaryOperatorId: hasExplicitPrimaryOperator ? configuredOperatorIds[0] : undefined,
    additionalOperatorIds: hasExplicitPrimaryOperator
      ? configuredOperatorIds.slice(1).filter((value) => value !== placeholderOperatorId).join(',')
      : nonPlaceholderOperatorIds.join(','),
    requiresPrompt: !hasExplicitPrimaryOperator,
  };
}

function selectAutomaticTelegramRouting(
  discovery: TelegramDiscoveryResult,
): TelegramRouting | undefined {
  const threadCandidates = discovery.chats.flatMap((chat) =>
    chat.threads.map((thread) => ({
      chatId: chat.id,
      threadId: thread.id,
      bindingSignal: Boolean(thread.bindingSignal),
    })),
  );

  if (threadCandidates.length === 1) {
    return {
      chatId: threadCandidates[0]!.chatId,
      threadId: threadCandidates[0]!.threadId,
    };
  }

  const bindingCandidates = threadCandidates.filter((candidate) => candidate.bindingSignal);
  if (bindingCandidates.length === 1) {
    return {
      chatId: bindingCandidates[0]!.chatId,
      threadId: bindingCandidates[0]!.threadId,
    };
  }

  return undefined;
}

async function collectTelegramRouting(
  telegramBotToken: string,
  options: {
    logger?: Logger;
    prompt: BirthPromptAdapter;
    requireThread: boolean;
  },
): Promise<TelegramRouting> {
  if (!options.requireThread) {
    options.logger?.info('Telegram will use DM-only operational output with no team summary topic.');
    return {
      chatId: '',
      threadId: '',
    };
  }

  const discovery = await discoverTelegramTargets(telegramBotToken);
  const automaticRouting = selectAutomaticTelegramRouting(discovery);
  if (automaticRouting) {
    options.logger?.info('Telegram thread_id resolved automatically from recent bot activity.');
    return automaticRouting;
  }

  options.logger?.info('Starting /collab-bind flow to resolve Telegram chat_id/thread_id.');
  return resolveTelegramRouting(telegramBotToken, options);
}

function hasListValue(value: readonly string[] | undefined): value is readonly string[] {
  return Array.isArray(value) && value.length > 0;
}

function inferGitHubOwnerFromRepository(repository: string | undefined): string | undefined {
  if (!hasTextValue(repository)) {
    return undefined;
  }

  const [owner] = repository.split('/');
  return owner?.trim().length ? owner.trim() : undefined;
}

function mergeDraftAnswers(
  input: AgentBootstrapInput,
  draftAnswers: AgentBirthWizardDraftAnswers | undefined,
): AgentBootstrapInput {
  if (!draftAnswers) {
    return input;
  }

  return {
    ...draftAnswers,
    ...input,
    egressUrl: input.egressUrl ?? draftAnswers.egressUrl,
    birthProfile: {
      ...(draftAnswers.birthProfile ?? {}),
      ...(input.birthProfile ?? {}),
    },
  };
}

function resolveBirthCollabDir(
  input: AgentBootstrapInput,
  dependencies: Partial<BirthWizardDependencies>,
  outputDir: string,
): string {
  return dependencies.collabDir ?? path.join(path.resolve(input.cwd, outputDir), '.collab');
}

function toDraftAnswers(seed: AgentBootstrapInput): AgentBirthWizardDraftAnswers {
  return {
    agentName: seed.agentName,
    agentSlug: seed.agentSlug,
    agentId: seed.agentId,
    scope: seed.scope,
    provider:
      hasTextValue(seed.provider)
        ? (seed.provider.trim().toLowerCase() as ProviderKey)
        : undefined,
    providerAuthMethod: seed.providerAuthMethod,
    model: seed.model,
    operatorId: seed.operatorId,
    githubAppId: seed.githubAppId,
    githubAppInstallationId: seed.githubAppInstallationId,
    githubAppOwner: seed.githubAppOwner,
    githubAppOwnerType: seed.githubAppOwnerType,
    githubAppPrivateKeyPath: seed.githubAppPrivateKeyPath,
    cognitiveMcpUrl: seed.cognitiveMcpUrl,
    cognitiveMcpApiKey: seed.cognitiveMcpApiKey,
    redisUrl: seed.redisUrl,
    redisPassword: seed.redisPassword,
    approvedNamespaces: seed.approvedNamespaces,
    egressUrl: seed.egressUrl,
    telegramEnabled: seed.telegramEnabled,
    telegramBotToken: seed.telegramBotToken,
    telegramDefaultChatId: seed.telegramDefaultChatId,
    telegramThreadId: seed.telegramThreadId,
    telegramAllowTopicCommands: seed.telegramAllowTopicCommands,
    telegramWebhookPublicBaseUrl: seed.telegramWebhookPublicBaseUrl,
    telegramWebhookSecret: seed.telegramWebhookSecret,
    telegramWebhookBindHost: seed.telegramWebhookBindHost,
    telegramWebhookPort: seed.telegramWebhookPort,
    selfRepository: seed.selfRepository,
    assignedRepositories: seed.assignedRepositories,
    output: seed.output,
    birthProfile: seed.birthProfile,
  };
}

function mergeBirthProfilePatch(
  existing: AgentBootstrapInput['birthProfile'],
  patch: AgentBootstrapInput['birthProfile'],
): AgentBootstrapInput['birthProfile'] {
  if (!existing && !patch) {
    return undefined;
  }

  return {
    ...(existing ?? {}),
    ...(patch ?? {}),
  };
}

function applyConversationPatch(
  seed: AgentBootstrapInput,
  patch: Partial<AgentBootstrapInput>,
): AgentBootstrapInput {
  return {
    ...seed,
    ...patch,
    birthProfile: mergeBirthProfilePatch(seed.birthProfile, patch.birthProfile),
    egressUrl: patch.egressUrl ?? seed.egressUrl,
  };
}

function mergeRepositoryList(
  existing: string | undefined,
  incoming: readonly string[] = [],
  exclude?: string,
): string | undefined {
  const merged = [
    ...parseCsvList(existing),
    ...incoming,
  ].filter((value) => value.length > 0 && value !== exclude);

  if (merged.length === 0) {
    return existing;
  }

  return [...new Set(merged)].join(',');
}

function shouldResetDeterministicInterviewTranscript(
  transcript: readonly BirthInterviewMessage[],
): boolean {
  if (transcript.length === 0) {
    return false;
  }

  return transcript.some((message) =>
    /(telegram|chat id|thread id|stable operator ids?|operator ids?|github app|installation id|private key path|self repo|self repository|assigned repositor|where will this agent|own code and configuration live|repository names)/i.test(message.content),
  );
}

function normalizeConversationPatch(
  capture: BirthInterviewCapture,
): Partial<AgentBootstrapInput> {
  if (!capture) {
    return {};
  }

  const patch: Partial<AgentBootstrapInput> = {};

  if (hasTextValue(capture.agentName)) {
    patch.agentName = capture.agentName;
  }
  if (hasTextValue(capture.agentSlug)) {
    patch.agentSlug = capture.agentSlug;
  }
  if (hasTextValue(capture.agentId)) {
    patch.agentId = capture.agentId;
  }
  if (hasTextValue(capture.scope)) {
    patch.scope = capture.scope;
  }
  if (capture.operatorIds && capture.operatorIds.length > 0) {
    patch.operatorId = capture.operatorIds.join(',');
  } else if (hasTextValue(capture.operatorId)) {
    patch.operatorId = capture.operatorId;
  }
  if (hasTextValue(capture.githubAppId)) {
    patch.githubAppId = capture.githubAppId;
  }
  if (hasTextValue(capture.githubAppInstallationId)) {
    patch.githubAppInstallationId = capture.githubAppInstallationId;
  }
  if (hasTextValue(capture.githubAppOwner)) {
    patch.githubAppOwner = capture.githubAppOwner;
  }
  if (capture.githubAppOwnerType) {
    patch.githubAppOwnerType = capture.githubAppOwnerType;
  }
  if (hasTextValue(capture.githubAppPrivateKeyPath)) {
    patch.githubAppPrivateKeyPath = capture.githubAppPrivateKeyPath;
  }
  if (hasTextValue(capture.selfRepository)) {
    patch.selfRepository = capture.selfRepository;
  }
  if (capture.assignedRepositories && capture.assignedRepositories.length > 0) {
    patch.assignedRepositories = capture.assignedRepositories.join(',');
  }
  if (capture.provider) {
    patch.provider = capture.provider;
  }
  if (capture.providerAuthMethod) {
    patch.providerAuthMethod = capture.providerAuthMethod;
  }
  if (
    capture.model !== undefined
    || capture.providerAuthMethod === 'cli'
    || capture.provider === 'copilot'
  ) {
    patch.model = capture.model;
  }
  if (hasTextValue(capture.cognitiveMcpUrl)) {
    patch.cognitiveMcpUrl = capture.cognitiveMcpUrl;
  }
  if (hasTextValue(capture.redisUrl)) {
    patch.redisUrl = capture.redisUrl;
  }
  if (capture.telegramEnabled !== undefined) {
    patch.telegramEnabled = capture.telegramEnabled;
  }
  if (hasTextValue(capture.telegramDefaultChatId)) {
    patch.telegramDefaultChatId = capture.telegramDefaultChatId;
  }
  if (hasTextValue(capture.telegramThreadId)) {
    patch.telegramThreadId = capture.telegramThreadId;
  }
  if (capture.telegramAllowTopicCommands !== undefined) {
    patch.telegramAllowTopicCommands = capture.telegramAllowTopicCommands;
  }
  if (capture.approvedNamespaces && capture.approvedNamespaces.length > 0) {
    patch.approvedNamespaces = capture.approvedNamespaces.join(',');
  }
  if (capture.egressUrl && capture.egressUrl.length > 0) {
    patch.egressUrl = capture.egressUrl;
  }
  if (capture.birthProfile && Object.keys(capture.birthProfile).length > 0) {
    patch.birthProfile = capture.birthProfile;
  }

  return patch;
}

async function runConversationalBirthInterview(
  seed: AgentBootstrapInput,
  repositories: BirthRepositorySelection | undefined,
  prompt: BirthPromptAdapter,
  logger: Logger | undefined,
  persistDraft: (patch: AgentBirthWizardDraftAnswers) => void,
  conversationAssistant: BirthInterviewAssistant,
  prevalidation: BirthWizardPrevalidation,
  stepNumber: number,
  collabDir: string,
  initialTranscript: readonly BirthInterviewMessage[] = [],
): Promise<AgentBootstrapInput> {
  const preferredProvider =
    typeof seed.provider === 'string' && seed.provider.trim().length > 0
      ? (seed.provider.trim().toLowerCase() as ProviderKey)
      : 'gemini';

  let current = applyConversationPatch(
    seed,
    repositories
      ? {
          selfRepository: repositories.selfRepository,
          assignedRepositories: repositories.assignedRepositories.join(','),
        }
      : {},
  );
  const transcript: BirthInterviewMessage[] =
    initialTranscript.length > 0
      ? [...initialTranscript]
      : [
          {
            role: 'assistant' as const,
            content:
              'I will define the birth of this agent with you. I will ask only for the gaps that matter to start the agent correctly.',
          },
        ];
  const maxTurns = 10;

  logger?.wizardStep(stepNumber, 'Birth Interview', prevalidation.selectedProvider?.label ?? 'LLM');
  logger?.info(prevalidation.reason);

  for (let turnIndex = 0; turnIndex < maxTurns; turnIndex += 1) {
    const pendingAssistantMessage =
      transcript.length > 1 && transcript[transcript.length - 1]?.role === 'assistant'
        ? transcript[transcript.length - 1]?.content
        : undefined;
    let currentAssistantMessage = pendingAssistantMessage;

    if (!pendingAssistantMessage) {
      const plannedTurn = await conversationAssistant.planTurn(
        preferredProvider,
        {
          agentName: current.agentName,
          agentSlug: current.agentSlug,
          agentId: current.agentId,
          scope: current.scope,
          operatorId:
            hasTextValue(current.operatorId)
              ? parseCsvList(current.operatorId)[0]
              : undefined,
          operatorIds:
            hasTextValue(current.operatorId)
              ? parseCsvList(current.operatorId)
              : undefined,
          githubAppId: current.githubAppId,
          githubAppInstallationId: current.githubAppInstallationId,
          githubAppOwner: current.githubAppOwner,
          githubAppOwnerType: current.githubAppOwnerType,
          githubAppPrivateKeyPath: current.githubAppPrivateKeyPath,
          selfRepository: repositories?.selfRepository ?? current.selfRepository,
          assignedRepositories:
            repositories?.assignedRepositories
            ?? (hasTextValue(current.assignedRepositories)
              ? parseCsvList(current.assignedRepositories)
              : undefined),
          provider:
            typeof current.provider === 'string'
              ? (current.provider.trim().toLowerCase() as ProviderKey)
              : undefined,
          providerAuthMethod: current.providerAuthMethod,
          model: current.model,
          cognitiveMcpUrl: current.cognitiveMcpUrl,
          redisUrl: current.redisUrl,
          telegramEnabled: current.telegramEnabled,
          telegramDefaultChatId: current.telegramDefaultChatId,
          telegramThreadId: current.telegramThreadId,
          telegramAllowTopicCommands: current.telegramAllowTopicCommands,
          approvedNamespaces:
            typeof current.approvedNamespaces === 'string'
              ? parseCsvList(current.approvedNamespaces)
              : undefined,
          egressUrl: current.egressUrl,
          birthProfile: current.birthProfile,
        },
        transcript,
      );

      if (!plannedTurn) {
        break;
      }

      if (plannedTurn.assistantMessage.trim().length > 0) {
        logger?.assistantMessage(prevalidation.selectedProvider?.label ?? 'Birth', plannedTurn.assistantMessage);
      }
      currentAssistantMessage = plannedTurn.assistantMessage;

      const patch = normalizeConversationPatch(plannedTurn.capture);
      current = applyConversationPatch(current, patch);
        persistDraft({
          agentName: current.agentName,
          agentSlug: current.agentSlug,
          agentId: current.agentId,
          scope: current.scope,
          operatorId: current.operatorId,
          githubAppId: current.githubAppId,
          githubAppInstallationId: current.githubAppInstallationId,
          githubAppOwner: current.githubAppOwner,
          githubAppOwnerType: current.githubAppOwnerType,
          githubAppPrivateKeyPath: current.githubAppPrivateKeyPath,
          provider:
            hasTextValue(current.provider)
            ? (current.provider.trim().toLowerCase() as ProviderKey)
            : undefined,
        providerAuthMethod: current.providerAuthMethod,
        model: current.model,
        cognitiveMcpUrl: current.cognitiveMcpUrl,
        cognitiveMcpApiKey: current.cognitiveMcpApiKey,
        redisUrl: current.redisUrl,
        redisPassword: current.redisPassword,
        approvedNamespaces: current.approvedNamespaces,
        egressUrl: current.egressUrl,
        telegramEnabled: current.telegramEnabled,
        telegramBotToken: current.telegramBotToken,
        telegramDefaultChatId: current.telegramDefaultChatId,
        telegramThreadId: current.telegramThreadId,
        telegramAllowTopicCommands: current.telegramAllowTopicCommands,
        selfRepository: current.selfRepository,
        assignedRepositories: current.assignedRepositories,
        birthProfile: current.birthProfile,
      });

      if (plannedTurn.status === 'complete') {
        return current;
      }

      transcript.push({
        role: 'assistant',
        content: plannedTurn.assistantMessage,
      });
      persistDraft({
        interviewTranscript: [...transcript],
      });
    } else {
      logger?.assistantMessage(
        prevalidation.selectedProvider?.label ?? 'Birth',
        pendingAssistantMessage,
      );
    }

    const answer = await prompt.text('Your answer');

    const extractedRepositories = extractGitHubRepositoryReferences(answer);
    if (extractedRepositories.length > 0) {
      const validRepositories = await validateGitHubRepositoryReferences(
        extractedRepositories,
        collabDir,
      );

      if (validRepositories.length > 0) {
        const selfRepositoryRequested = /self repo|self repository|own code|configuration live|where will this agent/i.test(
          currentAssistantMessage ?? '',
        );
        const nextSelfRepository =
          selfRepositoryRequested && !hasTextValue(current.selfRepository)
            ? validRepositories[0]
            : current.selfRepository;
        const nextAssignedRepositories = mergeRepositoryList(
          current.assignedRepositories,
          selfRepositoryRequested ? validRepositories.slice(1) : validRepositories,
          nextSelfRepository,
        );

        current = applyConversationPatch(current, {
          selfRepository: nextSelfRepository,
          assignedRepositories: nextAssignedRepositories,
        });

        persistDraft({
          selfRepository: current.selfRepository,
          assignedRepositories: current.assignedRepositories,
          telegramEnabled: current.telegramEnabled,
          telegramDefaultChatId: current.telegramDefaultChatId,
          telegramThreadId: current.telegramThreadId,
        });
      }
    }

    transcript.push({
      role: 'user',
      content: answer,
    });
    persistDraft({
      interviewTranscript: [...transcript],
    });
  }

  logger?.warn(
    'Conversational birth interview ended before all gaps were closed. Falling back to deterministic prompts for any remaining required fields.',
  );
  return current;
}

export async function collectAgentBirthInteractiveInput(
  input: AgentBootstrapInput,
  dependencies: Partial<BirthWizardDependencies> = {},
): Promise<AgentBootstrapInput> {
  const terminalUi =
    !dependencies.prompt && Boolean(dependencies.isInteractiveSession && process.stdin.isTTY && process.stdout.isTTY)
      ? new BirthWizardTerminalUi()
      : null;
  terminalUi?.start();

  const basePrompt = dependencies.prompt ?? defaultPromptAdapter();
  const prompt = terminalUi ? terminalUi.createPromptAdapter(basePrompt) : basePrompt;
  const logger = terminalUi ? terminalUi.createLogger(dependencies.logger) : dependencies.logger;
  const providerCliResolver = dependencies.providerCliResolver ?? detectProviderCli;
  const githubAppValidator = dependencies.githubAppValidator ?? validateGitHubAppIdentity;
  try {
    const resumeOutputDir = path.resolve(input.cwd, input.output ?? '.');
    const dryRun = Boolean(dependencies.dryRun);
    const draftAnswers =
      input.forceMode === 'rebirth'
        ? undefined
        : (() => {
            try {
              return loadBirthWizardDraft(resumeOutputDir);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              logger?.warn(`Ignoring unreadable birth wizard draft. ${message}`);
              return undefined;
            }
          })();
    let workingSeed = mergeDraftAnswers(input, draftAnswers);
    const output = workingSeed.output ?? '.';
    let draftOutputDir = path.resolve(input.cwd, output);
    let step = 0;
    const draftState: AgentBirthWizardDraftAnswers = {
      ...draftAnswers,
      ...toDraftAnswers(workingSeed),
    };

    const persistDraft = (patch: AgentBirthWizardDraftAnswers): void => {
      Object.assign(draftState, patch);

      if (dryRun) {
        return;
      }

      saveBirthWizardDraft(draftOutputDir, draftState);
    };

    if (input.forceMode === 'rebirth') {
      clearBirthWizardDraft(draftOutputDir);
      logger?.info('Force mode enabled: restarting the birth wizard from scratch.');
    } else if (draftAnswers) {
      logger?.info(
        `Resuming saved birth answers from ${buildBirthWizardDraftPath(draftOutputDir)}. Use --force rebirth to restart the wizard from scratch.`,
      );
    }

    logger?.wizardIntro('collab agent birth');

    logger?.wizardStep(++step, 'Workspace');
    const outputDir = hasTextValue(workingSeed.output)
      ? workingSeed.output
      : await prompt.text('Output directory', output);
    const resolvedOutputDir = path.resolve(input.cwd, outputDir);
    if (resolvedOutputDir !== draftOutputDir) {
      if (!dryRun) {
        clearBirthWizardDraft(draftOutputDir);
      }
      draftOutputDir = resolvedOutputDir;
    }
    persistDraft({ output: outputDir });

  const wizardMode = dependencies.wizardMode ?? 'structured';
  const wizardPrevalidationResolver =
    dependencies.wizardPrevalidationResolver ?? prevalidateBirthWizardMode;
  const conversationAssistant =
    dependencies.conversationAssistant
    ?? (logger
      ? createBirthInterviewAssistant(logger, {
          interactiveSession: Boolean(dependencies.isInteractiveSession),
        })
      : undefined);

  logger?.wizardStep(++step, 'Identity');
  const agentName = hasTextValue(workingSeed.agentName)
    ? workingSeed.agentName
    : await prompt.text('Agent name', workingSeed.agentName);
  persistDraft({ agentName });
  const inferredSlug = slugifyAgentName(
    workingSeed.agentSlug?.trim() || agentName.trim() || 'collab-agent',
  );
  const agentSlug = hasTextValue(workingSeed.agentSlug)
    ? workingSeed.agentSlug
    : await prompt.text('Agent slug', inferredSlug);
  persistDraft({ agentSlug });
  const agentId = hasTextValue(workingSeed.agentId)
    ? workingSeed.agentId
    : await prompt.text('Agent id', workingSeed.agentId ?? `agent.${agentSlug}`);
  persistDraft({ agentId });

  logger?.wizardStep(++step, 'Scope');
  const scope = hasTextValue(workingSeed.scope)
    ? workingSeed.scope
    : await prompt.text('Primary scope', workingSeed.scope ?? `agent.${agentSlug}`);
  persistDraft({ scope });
  logger?.wizardStep(++step, 'Operators');
  const operatorSeed = resolveOperatorSeed(workingSeed.operatorId, agentSlug);
  const primaryOperatorId = operatorSeed.requiresPrompt
    ? await prompt.text(
        'Primary operator id',
        'operator.telegram.<user-id>',
      )
    : operatorSeed.primaryOperatorId!;
  const additionalOperatorIds = operatorSeed.requiresPrompt
    ? await prompt.text(
        'Additional operators (comma-separated, optional)',
        operatorSeed.additionalOperatorIds,
      )
    : operatorSeed.additionalOperatorIds;
  const operatorId = [
    primaryOperatorId.trim(),
    ...parseCsvList(additionalOperatorIds),
  ].filter((value, index, collection) => value.length > 0 && collection.indexOf(value) === index).join(',');
  persistDraft({ operatorId });

  logger?.wizardStep(++step, 'Telegram');
  const telegramEnabled = true;
  const telegramBotToken = hasTextValue(workingSeed.telegramBotToken)
    ? workingSeed.telegramBotToken.trim()
    : await prompt.text(
        'TELEGRAM_BOT_TOKEN',
        workingSeed.telegramBotToken ?? process.env.TELEGRAM_BOT_TOKEN ?? '',
      );
  if (!hasTextValue(telegramBotToken)) {
    throw new Error('TELEGRAM_BOT_TOKEN is required for the agent birth wizard.');
  }
  persistDraft({ telegramEnabled, telegramBotToken });

  let telegramDefaultChatId = hasTextValue(workingSeed.telegramDefaultChatId)
    ? workingSeed.telegramDefaultChatId.trim()
    : '';
  let telegramThreadId = hasTextValue(workingSeed.telegramThreadId)
    ? workingSeed.telegramThreadId.trim()
    : '';
  const wantsTeamSummaryThread =
    hasTextValue(telegramThreadId)
      ? true
      : await prompt.choice(
          'Will this agent publish work summaries to a Telegram topic?',
          [
            {
              value: 'yes',
              label: 'Yes',
              description: 'Keep a group-visible summary thread for work progress',
            },
            {
              value: 'no',
              label: 'No',
              description: 'Use DM-only operational output with no team summary topic',
            },
          ],
          'yes',
        ) === 'yes';
  let telegramAllowTopicCommands = false;
  if (wantsTeamSummaryThread) {
    telegramAllowTopicCommands =
      workingSeed.telegramAllowTopicCommands
      ?? (await prompt.choice(
        'Accept commands from the team thread?',
        [
          {
            value: 'yes',
            label: 'Yes',
            description: 'Authorized operators can use the configured team thread as a command ingress',
          },
          {
            value: 'no',
            label: 'No',
            description: 'Only DMs from operators are treated as commands',
          },
        ],
        'no',
      ) === 'yes');

    if (!hasTextValue(telegramDefaultChatId) && !hasTextValue(telegramThreadId)) {
      const routing = await collectTelegramRouting(telegramBotToken, {
        logger,
        prompt,
        requireThread: true,
      });
      telegramDefaultChatId = routing.chatId;
      telegramThreadId = routing.threadId;
    }
  } else {
    telegramDefaultChatId = '';
    telegramThreadId = '';
    telegramAllowTopicCommands = false;
  }
  persistDraft({
    telegramEnabled,
    telegramBotToken,
    telegramDefaultChatId,
    telegramThreadId,
    telegramAllowTopicCommands,
  });
  const telegramWebhookPublicBaseUrl = hasTextValue(
    workingSeed.telegramWebhookPublicBaseUrl,
  )
    ? workingSeed.telegramWebhookPublicBaseUrl.trim()
    : await prompt.text(
        'TELEGRAM_WEBHOOK_PUBLIC_BASE_URL',
        workingSeed.telegramWebhookPublicBaseUrl ?? '',
      );
  const telegramWebhookSecret = hasTextValue(workingSeed.telegramWebhookSecret)
    ? workingSeed.telegramWebhookSecret.trim()
    : await prompt.text(
        'TELEGRAM_WEBHOOK_SECRET (optional)',
        workingSeed.telegramWebhookSecret ?? '',
      );
  const telegramWebhookBindHost = hasTextValue(workingSeed.telegramWebhookBindHost)
    ? workingSeed.telegramWebhookBindHost.trim()
    : '127.0.0.1';
  const telegramWebhookPort = hasTextValue(workingSeed.telegramWebhookPort)
    ? workingSeed.telegramWebhookPort.trim()
    : '8788';
  persistDraft({
    telegramWebhookPublicBaseUrl,
    telegramWebhookSecret,
    telegramWebhookBindHost,
    telegramWebhookPort,
  });

  logger?.wizardStep(++step, 'Repositories', 'GitHub selection');

  const repositoryPicker =
    dependencies.repositoryPicker
    ?? (logger
      ? {
          pickRepositories: () =>
            pickBirthRepositoriesFromGitHub({
              collabDir: resolveBirthCollabDir(input, dependencies, outputDir),
              logger,
              prompt,
            }),
        }
      : undefined);

  if (!repositoryPicker) {
    throw new Error('Birth repository picker requires a logger.');
  }

  const repositories =
    hasTextValue(workingSeed.selfRepository) && hasTextValue(workingSeed.assignedRepositories)
      ? {
          selfRepository: workingSeed.selfRepository,
          assignedRepositories: parseCsvList(workingSeed.assignedRepositories),
        }
      : await repositoryPicker.pickRepositories();
  persistDraft({
    selfRepository: repositories.selfRepository,
    assignedRepositories: repositories.assignedRepositories.join(','),
  });

  logger?.wizardStep(++step, 'GitHub App');
  let githubAppOwner =
    hasTextValue(workingSeed.githubAppOwner)
      ? workingSeed.githubAppOwner.trim()
      : inferGitHubOwnerFromRepository(repositories.selfRepository)
        ?? agentSlug;
  let githubAppOwnerType = workingSeed.githubAppOwnerType ?? 'auto';
  let githubAppId = hasTextValue(workingSeed.githubAppId)
    ? workingSeed.githubAppId.trim()
    : '';
  let githubAppInstallationId = hasTextValue(workingSeed.githubAppInstallationId)
    ? workingSeed.githubAppInstallationId.trim()
    : '';
  let githubAppPrivateKeyPath = hasTextValue(workingSeed.githubAppPrivateKeyPath)
    ? workingSeed.githubAppPrivateKeyPath.trim()
    : '';

  while (true) {
    if (!hasTextValue(githubAppId)) {
      githubAppId = await prompt.text(
        'GitHub App id',
        workingSeed.githubAppId ?? process.env.COLLAB_RUNTIME_GITHUB_APP_ID ?? '',
      );
    }
    if (!hasTextValue(githubAppInstallationId)) {
      githubAppInstallationId = await prompt.text(
        'GitHub App installation id',
        workingSeed.githubAppInstallationId
          ?? process.env.COLLAB_RUNTIME_GITHUB_APP_INSTALLATION_ID
          ?? '',
      );
    }
    if (!hasTextValue(githubAppPrivateKeyPath)) {
      githubAppPrivateKeyPath = await prompt.text(
        'GitHub App private key path',
        workingSeed.githubAppPrivateKeyPath
          ?? process.env.COLLAB_RUNTIME_GITHUB_APP_PRIVATE_KEY_PATH
          ?? '',
      );
    }

    persistDraft({
      githubAppId,
      githubAppInstallationId,
      githubAppOwner,
      githubAppOwnerType,
      githubAppPrivateKeyPath,
    });

    try {
      const validation = await githubAppValidator({
        appId: githubAppId,
        installationId: githubAppInstallationId,
        owner: githubAppOwner,
        ownerType: githubAppOwnerType,
        privateKeyPath: githubAppPrivateKeyPath,
        repositories: [repositories.selfRepository, ...repositories.assignedRepositories],
        cwd: input.cwd,
      });
      githubAppId = validation.appId;
      githubAppInstallationId = validation.installationId;
      githubAppOwner = validation.owner;
      githubAppOwnerType = validation.ownerType;
      githubAppPrivateKeyPath = validation.privateKeyPath;
      persistDraft({
        githubAppId,
        githubAppInstallationId,
        githubAppOwner,
        githubAppOwnerType,
        githubAppPrivateKeyPath,
      });
      logger?.info(
        `Validated GitHub App installation ${githubAppInstallationId} for ${githubAppOwner} across ${validation.validatedRepositories.length} repository${validation.validatedRepositories.length === 1 ? '' : 'ies'}.`,
      );
      break;
    } catch (error) {
      if (!(error instanceof GitHubAppValidationError)) {
        throw error;
      }

      logger?.warn(error.message);
      if (error.promptFields.includes('githubAppId')) {
        githubAppId = '';
      }
      if (error.promptFields.includes('githubAppInstallationId')) {
        githubAppInstallationId = '';
      }
      if (error.promptFields.includes('githubAppPrivateKeyPath')) {
        githubAppPrivateKeyPath = '';
      }
      persistDraft({
        githubAppId,
        githubAppInstallationId,
        githubAppOwner,
        githubAppOwnerType,
        githubAppPrivateKeyPath,
      });
    }
  }

  if (wizardMode === 'auto') {
    const preferredProvider =
      hasTextValue(workingSeed.provider)
        ? (workingSeed.provider.trim().toLowerCase() as ProviderKey)
        : 'gemini';
    const prevalidation = wizardPrevalidationResolver(preferredProvider);

    if (prevalidation.mode === 'conversational' && conversationAssistant) {
      const initialTranscript = shouldResetDeterministicInterviewTranscript(
        draftAnswers?.interviewTranscript ?? [],
      )
        ? []
        : (draftAnswers?.interviewTranscript ?? []);
      if (initialTranscript.length === 0 && (draftAnswers?.interviewTranscript?.length ?? 0) > 0) {
        logger?.info(
          'Resetting the saved conversational interview transcript because operator, GitHub App, and Telegram routing are now collected deterministically by the wizard.',
        );
      }
      workingSeed = await runConversationalBirthInterview(
        {
          ...workingSeed,
          output: outputDir,
          agentName,
          agentSlug,
          agentId,
          scope,
          operatorId,
          githubAppId,
          githubAppInstallationId,
          githubAppOwner,
          githubAppOwnerType,
          githubAppPrivateKeyPath,
          telegramEnabled,
          telegramBotToken,
          telegramDefaultChatId,
          telegramThreadId,
          telegramAllowTopicCommands,
          telegramWebhookPublicBaseUrl,
          telegramWebhookSecret,
          telegramWebhookBindHost,
          telegramWebhookPort,
        },
        repositories,
        prompt,
        logger,
        persistDraft,
        conversationAssistant,
        prevalidation,
        ++step,
        resolveBirthCollabDir(input, dependencies, outputDir),
        initialTranscript,
      );
    } else {
      logger?.info(prevalidation.reason);
    }
  }

  logger?.wizardStep(++step, 'Mission');
  const defaultRole = workingSeed.birthProfile?.personaRole?.trim() || `${humanizeAgentSlug(agentSlug)} lead`;
  const personaRole = hasTextValue(workingSeed.birthProfile?.personaRole)
    ? workingSeed.birthProfile?.personaRole
    : await prompt.text('Primary role', defaultRole);
  const defaultPurpose =
    workingSeed.birthProfile?.purpose?.trim()
    || `Build and operate ${repositories.selfRepository}${repositories.assignedRepositories.length > 0 ? ` while delivering work across ${repositories.assignedRepositories.join(', ')}` : ''} as a real Collab agent.`;
  const purpose = hasTextValue(workingSeed.birthProfile?.purpose)
    ? workingSeed.birthProfile?.purpose
    : await prompt.text('What will this agent do?', defaultPurpose);
  const defaultSoulMission =
    workingSeed.birthProfile?.soulMission?.trim()
    || `Make ${humanizeAgentSlug(agentSlug)} reliable, visible, and useful through explicit Collab contracts and GitHub-based delivery.`;
  const soulMission = hasTextValue(workingSeed.birthProfile?.soulMission)
    ? workingSeed.birthProfile?.soulMission
    : await prompt.text('Soul mission', defaultSoulMission);
  const birthProfile = {
    ...(workingSeed.birthProfile ?? {}),
    personaRole,
    purpose,
    soulMission,
  };
  persistDraft({ birthProfile });

  logger?.wizardStep(++step, 'Runtime');
  const providerDefaultValue: ProviderKey =
    hasTextValue(workingSeed.provider)
      ? (workingSeed.provider.trim().toLowerCase() as ProviderKey)
      : 'gemini';
  const provider = hasTextValue(workingSeed.provider)
    ? providerDefaultValue
    : dependencies.wizardMode === 'auto'
      ? ((await prompt.text(
          'Runtime provider (codex, claude, gemini, copilot)',
          providerDefaultValue,
        )).trim().toLowerCase() as ProviderKey)
      : await prompt.choice(
          'Default provider',
          PROVIDER_KEYS.map((value) => ({
            value,
            label: PROVIDER_DEFAULTS[value].label,
            description: PROVIDER_DEFAULTS[value].description,
          })),
          providerDefaultValue,
        );
  persistDraft({ provider });
  const providerCli = providerCliResolver(provider);
  const providerDefaults = PROVIDER_DEFAULTS[provider];
  const defaultAuthMethod: AuthMethod =
    provider === 'copilot'
      ? 'cli'
      : ((workingSeed.providerAuthMethod as AuthMethod | undefined) ?? 'api-key');
  const providerAuthMethod =
    provider === 'copilot'
      ? 'cli'
      : hasTextValue(workingSeed.providerAuthMethod)
        ? (workingSeed.providerAuthMethod as AuthMethod)
        : providerCli.available
        ? dependencies.wizardMode === 'auto'
          ? ((await prompt.text(
              `Authentication for ${providerDefaults.label} (cli or api-key)`,
              defaultAuthMethod,
            )).trim().toLowerCase() as AuthMethod)
          : await prompt.choice<AuthMethod>(
              `Authentication for ${providerDefaults.label}`,
              [
                {
                  value: 'cli',
                  label: `Use ${providerCli.command} CLI`,
                  description: providerCli.configuredModel
                    ? `Configured model: ${providerCli.configuredModel}`
                    : 'Model comes from the CLI configuration or CLI defaults',
                },
                {
                  value: 'api-key',
                  label: `Use API key (${providerDefaults.envVar})`,
                  description: 'Model is configured in the generated agent scaffold',
                },
              ],
              defaultAuthMethod,
            )
        : 'api-key';
  persistDraft({ providerAuthMethod });

  const defaultModel =
    workingSeed.model?.trim() || PROVIDER_DEFAULTS[provider].models[0] || provider;
  const model =
    provider === 'copilot' || providerAuthMethod === 'cli'
      ? undefined
      : hasTextValue(workingSeed.model)
        ? workingSeed.model
        : await prompt.text('Default model', defaultModel);
  persistDraft({ model });

  if (providerAuthMethod === 'cli' && providerCli.configuredModel) {
    logger?.info(`CLI model detected for ${providerDefaults.label}: ${providerCli.configuredModel}`);
  }

  const cognitiveMcpUrl = hasTextValue(workingSeed.cognitiveMcpUrl)
    ? workingSeed.cognitiveMcpUrl
    : await prompt.text(
        'Cognitive MCP URL',
        workingSeed.cognitiveMcpUrl ?? DEFAULT_MCP_URL,
      );
  persistDraft({ cognitiveMcpUrl });
  const redisUrl = hasTextValue(workingSeed.redisUrl)
    ? workingSeed.redisUrl
    : await prompt.text('Redis URL', workingSeed.redisUrl ?? DEFAULT_REDIS_URL);
  persistDraft({ redisUrl });

  const cognitiveMcpApiKey = hasTextValue(workingSeed.cognitiveMcpApiKey)
    ? workingSeed.cognitiveMcpApiKey
    : await prompt.text(
        'Cognitive MCP API key (optional)',
        workingSeed.cognitiveMcpApiKey ?? process.env.COGNITIVE_MCP_API_KEY ?? '',
      );
  const redisPassword = hasTextValue(workingSeed.redisPassword)
    ? workingSeed.redisPassword
    : await prompt.text(
        'Redis password',
        workingSeed.redisPassword ?? process.env.REDIS_PASSWORD ?? 'collab-dev-redis',
      );
  persistDraft({
    cognitiveMcpApiKey,
    redisPassword,
  });

  logger?.wizardStep(++step, 'Boundaries');
  const approvedNamespaces = hasTextValue(workingSeed.approvedNamespaces)
    ? workingSeed.approvedNamespaces
    : await prompt.text(
        'Approved namespaces (comma-separated)',
        workingSeed.approvedNamespaces ?? DEFAULT_WORKER_NAMESPACES.join(','),
      );
  persistDraft({ approvedNamespaces });
  const egressDefault = workingSeed.egressUrl?.join(',') || defaultEgressUrls(provider).join(',');
  const egressUrls = hasListValue(workingSeed.egressUrl)
    ? workingSeed.egressUrl.join(',')
    : await prompt.text(
        'Egress URLs (comma-separated, or * for all)',
        egressDefault,
      );
  const parsedEgressUrls = egressUrls.trim().length > 0
    ? parseCsvList(egressUrls)
    : workingSeed.egressUrl;
  persistDraft({ egressUrl: parsedEgressUrls });

    logger?.wizardOutro(`Birth answers captured for ${agentName || humanizeAgentSlug(agentSlug)}`);

    return {
      ...workingSeed,
      output: outputDir,
      agentName,
      agentSlug,
      agentId,
      scope,
      operatorId,
      githubAppId,
      githubAppInstallationId,
      githubAppOwner,
      githubAppOwnerType,
      githubAppPrivateKeyPath,
      selfRepository: repositories.selfRepository,
      assignedRepositories: repositories.assignedRepositories.join(','),
      provider,
      providerAuthMethod,
      model,
      cognitiveMcpUrl,
      cognitiveMcpApiKey,
      redisUrl,
      redisPassword,
      telegramEnabled,
      telegramBotToken,
      telegramDefaultChatId,
      telegramThreadId,
      telegramAllowTopicCommands,
      telegramWebhookPublicBaseUrl,
      telegramWebhookSecret,
      telegramWebhookBindHost,
      telegramWebhookPort,
      approvedNamespaces,
      egressUrl: parsedEgressUrls,
      birthProfile,
    };
  } finally {
    terminalUi?.stop();
  }
}
