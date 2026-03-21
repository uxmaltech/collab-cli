import path from 'node:path';

import { detectProviderCli } from '../cli-detection';
import { CliError } from '../errors';
import { parseForceMode } from '../force-mode';
import { PROVIDER_DEFAULTS, isProviderKey } from '../providers';
import {
  DEFAULT_MCP_URL,
  DEFAULT_OPERATOR_NAMESPACES,
  DEFAULT_PROVIDER,
  DEFAULT_REDIS_URL,
  DEFAULT_RUNTIME_SOURCE,
  DEFAULT_WORKER_NAMESPACES,
  defaultEgressUrls,
  humanizeAgentSlug,
  parseMergedList,
  parseCsvList,
  slugifyAgentName,
} from './defaults';
import { defaultBirthProfileFromOptions, mergeBirthProfileFields } from './profile';
import {
  AGENT_BOOTSTRAP_FORCE_MODES,
  type AgentBootstrapForceMode,
  type AgentBootstrapInput,
  type AgentBootstrapOptions,
} from './types';

function normalizeOperatorId(value: string): string {
  const trimmed = value.trim();

  if (/^\d+$/.test(trimmed)) {
    return `operator.telegram.${trimmed}`;
  }

  return trimmed;
}

export function normalizeAgentBootstrapOptions(input: AgentBootstrapInput): AgentBootstrapOptions {
  const outputDir = path.resolve(input.cwd, input.output ?? '.');
  const inferredSlug = slugifyAgentName(
    input.agentSlug?.trim() || input.agentName?.trim() || path.basename(outputDir),
  );
  const agentName = (input.agentName?.trim() || humanizeAgentSlug(inferredSlug)).trim();
  const providerValue = (input.provider?.trim().toLowerCase() || DEFAULT_PROVIDER).trim();

  if (!isProviderKey(providerValue)) {
    throw new CliError(
      `Invalid provider '${providerValue}'. Valid providers: ${Object.keys(PROVIDER_DEFAULTS).join(', ')}`,
    );
  }

  const runtimeSource = input.runtimeSource?.trim() || DEFAULT_RUNTIME_SOURCE;
  const forceMode = parseForceMode(
    input.forceMode,
    AGENT_BOOTSTRAP_FORCE_MODES,
    'collab agent birth',
  ) as AgentBootstrapForceMode | undefined;
  const providerCli = detectProviderCli(providerValue);
  const requestedAuthMethod = input.providerAuthMethod?.trim();
  const providerAuthMethod =
    providerValue === 'copilot'
      ? 'cli'
      : requestedAuthMethod === undefined || requestedAuthMethod.length === 0
        ? 'api-key'
        : requestedAuthMethod;

  if (providerAuthMethod !== 'api-key' && providerAuthMethod !== 'cli') {
    throw new CliError(`Invalid provider auth method '${providerAuthMethod}'. Use 'api-key' or 'cli'.`);
  }

  const cognitiveMcpUrl = input.cognitiveMcpUrl?.trim() || DEFAULT_MCP_URL;
  const cognitiveMcpApiKey =
    input.cognitiveMcpApiKey?.trim()
    || process.env.COGNITIVE_MCP_API_KEY?.trim()
    || '';
  const selfRepository = input.selfRepository?.trim() || `local/${inferredSlug}`;
  const assignedRepositories = parseCsvList(input.assignedRepositories);
  const approvedNamespaces = parseCsvList(input.approvedNamespaces, DEFAULT_WORKER_NAMESPACES);
  const operatorNamespaces = [...DEFAULT_OPERATOR_NAMESPACES];
  const egressUrls = parseMergedList(undefined, input.egressUrl, defaultEgressUrls(providerValue));
  const telegramBotToken =
    input.telegramBotToken?.trim()
    || process.env.TELEGRAM_BOT_TOKEN?.trim()
    || '';
  const telegramDefaultChatId =
    input.telegramDefaultChatId?.trim()
    || process.env.TELEGRAM_DEFAULT_CHAT_ID?.trim()
    || '';
  const telegramThreadId =
    input.telegramThreadId?.trim()
    || process.env.TELEGRAM_THREAD_ID?.trim()
    || '';
  const telegramAllowTopicCommands =
    input.telegramAllowTopicCommands
      ?? Boolean(telegramThreadId);
  const telegramEnabled = input.telegramEnabled ?? true;
  const redisPassword =
    input.redisPassword?.trim()
    || process.env.REDIS_PASSWORD?.trim()
    || 'collab-dev-redis';
  const operatorIds = parseCsvList(input.operatorId, [`operator.${inferredSlug}`]).map(
    normalizeOperatorId,
  );
  const primaryOperatorId = operatorIds[0];

  const baseOptions = {
    cwd: input.cwd,
    outputDir,
    agentName,
    agentSlug: inferredSlug,
    agentId: input.agentId?.trim() || `agent.${inferredSlug}`,
    scope: input.scope?.trim() || `agent.${inferredSlug}`,
    runtimeSource,
    provider: providerValue,
    providerAuthMethod,
    providerCli,
    model:
      providerAuthMethod === 'cli'
        ? undefined
        : input.model?.trim() || PROVIDER_DEFAULTS[providerValue].models[0] || providerValue,
    operatorId: primaryOperatorId,
    operatorIds,
    cognitiveMcpUrl,
    cognitiveMcpApiKey,
    redisUrl: input.redisUrl?.trim() || DEFAULT_REDIS_URL,
    redisPassword,
    approvedNamespaces,
    operatorNamespaces,
    egressUrls,
    telegramEnabled,
    telegramBotToken,
    telegramDefaultChatId,
    telegramThreadId,
    telegramAllowTopicCommands,
    selfRepository,
    assignedRepositories,
    forceMode,
    overwriteExistingManagedFiles: forceMode === 'overwrite' || forceMode === 'rebirth',
    restartWizardFromScratch: forceMode === 'rebirth',
    json: Boolean(input.json),
    telemetryEnabled: input.telemetryEnabled !== false,
    operatorProfileEnabled: input.operatorProfileEnabled !== false,
  } satisfies Omit<AgentBootstrapOptions, 'birthProfile'>;

  return {
    ...baseOptions,
    birthProfile: mergeBirthProfileFields(
      defaultBirthProfileFromOptions(baseOptions, input.birthProfile),
      input.birthProfile,
    ),
  };
}
