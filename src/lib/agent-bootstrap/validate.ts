import { CliError } from '../errors';
import { isProviderKey } from '../providers';
import type { AgentBootstrapOptions } from './types';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TELEGRAM_OPERATOR_ID_PATTERN = /^operator\.telegram\.\d+$/;

function ensureNonEmpty(label: string, value: string): void {
  if (value.trim().length === 0) {
    throw new CliError(`${label} must not be empty.`);
  }
}

function ensureNoWhitespace(label: string, value: string): void {
  if (/\s/.test(value)) {
    throw new CliError(`${label} must not contain whitespace.`);
  }
}

function ensureUrl(label: string, value: string): void {
  try {
    new URL(value);
  } catch {
    throw new CliError(`${label} must be a valid URL.`);
  }
}

export function validateAgentBootstrapOptions(options: AgentBootstrapOptions): void {
  ensureNonEmpty('Agent name', options.agentName);
  ensureNonEmpty('Runtime source', options.runtimeSource);
  ensureNonEmpty('Scope', options.scope);
  ensureNonEmpty('Agent id', options.agentId);
  ensureNonEmpty('Operator id', options.operatorId);
  ensureNoWhitespace('Agent id', options.agentId);
  ensureNoWhitespace('Operator id', options.operatorId);
  if (options.operatorIds.length === 0) {
    throw new CliError('At least one operator id is required.');
  }
  for (const operatorId of options.operatorIds) {
    ensureNonEmpty('Operator id', operatorId);
    ensureNoWhitespace('Operator id', operatorId);
  }
  if (options.githubAppId.trim().length > 0) {
    ensureNoWhitespace('GitHub App id', options.githubAppId);
  }
  if (options.githubAppInstallationId.trim().length > 0) {
    ensureNoWhitespace('GitHub App installation id', options.githubAppInstallationId);
  }
  if (options.githubAppOwner.trim().length > 0) {
    ensureNoWhitespace('GitHub App owner', options.githubAppOwner);
  }

  if (!SLUG_PATTERN.test(options.agentSlug)) {
    throw new CliError(
      `Agent slug '${options.agentSlug}' is invalid. Use lowercase letters, numbers, and hyphens.`,
    );
  }

  if (!isProviderKey(options.provider)) {
    throw new CliError(`Unsupported provider '${options.provider}'.`);
  }

  if (options.providerAuthMethod !== 'api-key' && options.providerAuthMethod !== 'cli') {
    throw new CliError(`Unsupported provider auth method '${options.providerAuthMethod}'.`);
  }

  if (options.providerAuthMethod === 'api-key') {
    ensureNonEmpty('Model', options.model ?? '');
  }

  ensureUrl('Cognitive MCP URL', options.cognitiveMcpUrl);
  ensureUrl('Redis URL', options.redisUrl);
  ensureNonEmpty('Redis password', options.redisPassword);

  if (options.approvedNamespaces.length === 0) {
    throw new CliError('At least one approved namespace is required.');
  }

  for (const namespace of [...options.approvedNamespaces, ...options.operatorNamespaces]) {
    ensureNonEmpty('Namespace', namespace);
  }

  ensureNonEmpty('Self repository', options.selfRepository);
  ensureNoWhitespace('Self repository', options.selfRepository);

  for (const repo of options.assignedRepositories) {
    ensureNonEmpty('Assigned repository', repo);
    ensureNoWhitespace('Assigned repository', repo);
  }

  for (const url of options.egressUrls) {
    if (url === '*') {
      continue;
    }
    ensureUrl('Egress URL', url);
  }

  if (!options.telegramEnabled) {
    throw new CliError('Telegram is required during agent birth.');
  }

  ensureNonEmpty('Telegram bot token', options.telegramBotToken);
  const hasTelegramOperator = options.operatorIds.some((operatorId) => TELEGRAM_OPERATOR_ID_PATTERN.test(operatorId));
  if (!hasTelegramOperator) {
    throw new CliError(
      'Telegram requires at least one operator id like operator.telegram.<user-id> so operational output can go to the originating operator by DM.',
    );
  }

  if (options.telegramThreadId.trim().length > 0) {
    ensureNonEmpty('Telegram default chat id', options.telegramDefaultChatId);
  } else if (options.telegramDefaultChatId.trim().length > 0) {
    throw new CliError(
      'TELEGRAM_DEFAULT_CHAT_ID without TELEGRAM_THREAD_ID is not valid. Use the thread as the team summary channel, or leave both empty for DM-only operation.',
    );
  }

  if (options.telegramAllowTopicCommands && options.telegramThreadId.trim().length === 0) {
    throw new CliError('Topic command ingress requires TELEGRAM_THREAD_ID.');
  }

  ensureNonEmpty('Purpose', options.birthProfile.purpose);
  ensureNonEmpty('Persona role', options.birthProfile.personaRole);
  ensureNonEmpty('Persona tone', options.birthProfile.personaTone);
  ensureNonEmpty('Persona summary', options.birthProfile.personaSummary);
  ensureNonEmpty('Soul mission', options.birthProfile.soulMission);
  ensureNonEmpty('Soul ethos', options.birthProfile.soulEthos);
  ensureNonEmpty('System prompt', options.birthProfile.systemPrompt);
  ensureNonEmpty('Work style planning mode', options.birthProfile.workStylePlanningMode);
  ensureNonEmpty('Work style approval posture', options.birthProfile.workStyleApprovalPosture);
  ensureNonEmpty(
    'Work style collaboration style',
    options.birthProfile.workStyleCollaborationStyle,
  );

  if (options.birthProfile.soulGuardrails.length === 0) {
    throw new CliError('At least one soul guardrail is required.');
  }

  if (options.birthProfile.styleRules.length === 0) {
    throw new CliError('At least one prompt style rule is required.');
  }
}
