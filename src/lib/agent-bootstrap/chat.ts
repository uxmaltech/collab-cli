import type { Logger } from '../logger';
import { isProviderKey, type AuthMethod, type ProviderKey } from '../providers';
import { buildBirthInterviewSystemPrompt } from './birth-interview-skill';
import { detectBirthLlmProviders } from './env-taxonomy';
import type { AgentBirthProfile, AgentBootstrapOptions } from './types';

export interface BirthDraftAssistant {
  draftProfile(options: AgentBootstrapOptions): Promise<Partial<AgentBirthProfile> | null>;
}

export interface BirthInterviewMessage {
  role: 'assistant' | 'user';
  content: string;
}

export interface BirthInterviewTurn {
  status: 'needs_input' | 'complete';
  assistantMessage: string;
  missing: string[];
  capture: BirthInterviewCapture;
}

export interface BirthInterviewCapture {
  agentName?: string;
  agentSlug?: string;
  agentId?: string;
  scope?: string;
  operatorId?: string;
  operatorIds?: string[];
  selfRepository?: string;
  assignedRepositories?: string[];
  provider?: ProviderKey;
  providerAuthMethod?: AuthMethod;
  model?: string;
  cognitiveMcpUrl?: string;
  redisUrl?: string;
  telegramEnabled?: boolean;
  telegramDefaultChatId?: string;
  telegramThreadId?: string;
  telegramAllowTopicCommands?: boolean;
  approvedNamespaces?: string[];
  egressUrl?: string[];
  birthProfile?: Partial<AgentBirthProfile>;
}

export interface BirthInterviewAssistant {
  planTurn(
    preferredProvider: ProviderKey,
    currentState: BirthInterviewCapture,
    transcript: readonly BirthInterviewMessage[],
  ): Promise<BirthInterviewTurn | null>;
}

export interface BirthDraftAssistantOptions {
  interactiveSession?: boolean;
}

interface ParsedObject extends Record<string, unknown> {}
interface GeminiResponsePart {
  text?: string;
  thought?: boolean;
}

interface GeminiGenerateContentPayload {
  candidates?: Array<{
    content?: {
      parts?: GeminiResponsePart[];
    };
  }>;
}

interface ThoughtRenderState {
  seenThoughtKeys: Set<string>;
}

interface SseEvent {
  event?: string;
  data: string[];
}

interface OpenAiResponsesCompletedEvent {
  response?: {
    output?: Array<{
      type?: string;
      content?: Array<{
        type?: string;
        text?: string;
      }>;
    }>;
  };
}

interface BirthInterviewPayload extends ParsedObject {
  status?: string;
  assistantMessage?: string;
  missing?: unknown;
  capture?: unknown;
}

type BirthJsonValidator = (payload: ParsedObject) => string[];

const MAX_BIRTH_MODEL_ATTEMPTS = 3;
const PROFILE_STRING_FIELDS = [
  'purpose',
  'personaRole',
  'personaTone',
  'personaSummary',
  'soulMission',
  'soulEthos',
  'systemPrompt',
  'workStylePlanningMode',
  'workStyleApprovalPosture',
  'workStyleCollaborationStyle',
] as const;
const PROFILE_ARRAY_FIELDS = [
  'soulGuardrails',
  'styleRules',
] as const;
const FORBIDDEN_MODEL_KEYS = [
  'operatorId',
  'operatorIds',
  'telegramEnabled',
  'telegramDefaultChatId',
  'telegramThreadId',
  'telegramAllowTopicCommands',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_DEFAULT_CHAT_ID',
  'TELEGRAM_THREAD_ID',
  'COGNITIVE_MCP_API_KEY',
  'REDIS_PASSWORD',
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'XAI_API_KEY',
  'ANTHROPIC_API_KEY',
] as const;
const INTERVIEW_CAPTURE_STRING_FIELDS = [
  'agentName',
  'agentSlug',
  'agentId',
  'scope',
  'selfRepository',
  'model',
  'cognitiveMcpUrl',
  'redisUrl',
] as const;
const INTERVIEW_CAPTURE_ARRAY_FIELDS = [
  'assignedRepositories',
  'approvedNamespaces',
  'egressUrl',
] as const;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every((item) => typeof item === 'string' && item.trim().length > 0);
}

function buildRetryPrompt(
  basePrompt: string,
  issues: readonly string[],
  previousPayload: ParsedObject,
): string {
  return [
    basePrompt,
    '',
    'The previous JSON response was rejected.',
    'Validation issues:',
    ...issues.map((issue) => `- ${issue}`),
    '',
    'Return a corrected JSON object only.',
    'Do not repeat invalid fields.',
    'Previous JSON response:',
    JSON.stringify(previousPayload, null, 2),
  ].join('\n');
}

function validateBirthProfilePayload(
  payload: ParsedObject,
  options: {
    requireAtLeastOneField: boolean;
    pathPrefix?: string;
  },
): string[] {
  const issues: string[] = [];
  let recognizedFieldCount = 0;
  const prefix = options.pathPrefix ? `${options.pathPrefix}.` : '';

  for (const key of FORBIDDEN_MODEL_KEYS) {
    if (key in payload) {
      issues.push(`${prefix}${key} must not be emitted by the model.`);
    }
  }

  for (const key of PROFILE_STRING_FIELDS) {
    if (!(key in payload)) {
      continue;
    }

    recognizedFieldCount += 1;
    if (typeof payload[key] !== 'string' || payload[key].trim().length === 0) {
      issues.push(`${prefix}${key} must be a non-empty string.`);
    }
  }

  for (const key of PROFILE_ARRAY_FIELDS) {
    if (!(key in payload)) {
      continue;
    }

    recognizedFieldCount += 1;
    if (!isStringArray(payload[key])) {
      issues.push(`${prefix}${key} must be an array of non-empty strings.`);
    }
  }

  if (options.requireAtLeastOneField && recognizedFieldCount === 0) {
    issues.push(`${prefix || 'birth profile.'}at least one birth profile field must be populated by the model.`);
  }

  return issues;
}

function validateBirthDraftPayload(payload: ParsedObject): string[] {
  return validateBirthProfilePayload(payload, {
    requireAtLeastOneField: true,
  });
}

function validateBirthInterviewPayload(payload: ParsedObject): string[] {
  const issues: string[] = [];
  const status = payload.status;
  const assistantMessage = payload.assistantMessage;
  const missing = payload.missing;
  const capture = payload.capture;

  if (status !== undefined && status !== 'needs_input' && status !== 'complete') {
    issues.push('status must be "needs_input" or "complete".');
  }

  if (typeof assistantMessage !== 'string' || assistantMessage.trim().length === 0) {
    issues.push('assistantMessage must be a non-empty string.');
  } else if (/(operator ids?|chat id|thread id|bot token)/i.test(assistantMessage)) {
    issues.push('assistantMessage must not ask for operator ids, chat ids, thread ids, or bot tokens.');
  }

  if (missing !== undefined && !isStringArray(missing)) {
    issues.push('missing must be an array of non-empty strings.');
  }

  if (capture === undefined) {
    return issues;
  }

  if (!capture || typeof capture !== 'object' || Array.isArray(capture)) {
    issues.push('capture must be an object when present.');
    return issues;
  }

  const capturePayload = capture as ParsedObject;

  for (const key of FORBIDDEN_MODEL_KEYS) {
    if (key in capturePayload) {
      issues.push(`capture.${key} must not be emitted by the model.`);
    }
  }

  for (const key of INTERVIEW_CAPTURE_STRING_FIELDS) {
    if (!(key in capturePayload)) {
      continue;
    }

    if (typeof capturePayload[key] !== 'string' || capturePayload[key].trim().length === 0) {
      issues.push(`capture.${key} must be a non-empty string.`);
    }
  }

  for (const key of INTERVIEW_CAPTURE_ARRAY_FIELDS) {
    if (!(key in capturePayload)) {
      continue;
    }

    if (!isStringArray(capturePayload[key])) {
      issues.push(`capture.${key} must be an array of non-empty strings.`);
    }
  }

  if ('provider' in capturePayload && toOptionalProviderKey(capturePayload.provider) === undefined) {
    issues.push('capture.provider must be one of codex, claude, gemini, or copilot.');
  }

  if (
    'providerAuthMethod' in capturePayload
    && toOptionalAuthMethod(capturePayload.providerAuthMethod) === undefined
  ) {
    issues.push('capture.providerAuthMethod must be "api-key" or "cli".');
  }

  if ('birthProfile' in capturePayload) {
    if (
      !capturePayload.birthProfile
      || typeof capturePayload.birthProfile !== 'object'
      || Array.isArray(capturePayload.birthProfile)
    ) {
      issues.push('capture.birthProfile must be an object when present.');
    } else {
      issues.push(
        ...validateBirthProfilePayload(capturePayload.birthProfile as ParsedObject, {
          requireAtLeastOneField: false,
          pathPrefix: 'capture.birthProfile',
        }),
      );
    }
  }

  return issues;
}

async function generateValidatedJsonWithSelectedProvider(
  selected: NonNullable<ReturnType<typeof selectBirthLlmProvider>>,
  prompt: string,
  logger: Logger,
  interactiveSession: boolean,
  validator: BirthJsonValidator,
  contextLabel: string,
): Promise<ParsedObject> {
  let currentPrompt = prompt;
  let lastIssues: string[] = [];

  for (let attempt = 1; attempt <= MAX_BIRTH_MODEL_ATTEMPTS; attempt += 1) {
    const payload = await generateJsonWithSelectedProvider(
      selected,
      currentPrompt,
      logger,
      interactiveSession,
    );
    const issues = validator(payload);

    if (issues.length === 0) {
      return payload;
    }

    lastIssues = issues;
    logger.warn(
      `${selected.label} returned an invalid ${contextLabel} payload on attempt ${attempt}/${MAX_BIRTH_MODEL_ATTEMPTS}. Retrying with validation feedback.`,
    );
    currentPrompt = buildRetryPrompt(prompt, issues, payload);
  }

  throw new Error(
    `${selected.label} could not produce a valid ${contextLabel} payload after ${MAX_BIRTH_MODEL_ATTEMPTS} attempts. ${lastIssues.join(' ')}`,
  );
}

function parseThoughtDisplay(rawText: string): { title: string; body?: string } {
  const text = rawText.trim();
  const markdownHeadingMatch = text.match(/^\*\*(.+?)\*\*\s*([\s\S]*)$/);
  if (markdownHeadingMatch) {
    const [, title, body] = markdownHeadingMatch;
    return {
      title: title.trim(),
      body: body.trim() || undefined,
    };
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length > 1) {
    return {
      title: lines[0],
      body: lines.slice(1).join(' '),
    };
  }

  return {
    title: 'Thought',
    body: text,
  };
}

function normalizeThoughtKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildThoughtDedupKey(thought: { title: string; body?: string }): string {
  const normalizedTitle = normalizeThoughtKeyPart(thought.title);
  if (normalizedTitle !== 'thought') {
    return normalizedTitle;
  }

  return `${normalizedTitle}:${normalizeThoughtKeyPart(thought.body ?? '')}`;
}

function emitThoughtIfNew(
  providerLabel: string,
  rawText: string,
  logger: Logger | undefined,
  state: ThoughtRenderState,
): void {
  const thoughtText = rawText.trim();
  if (thoughtText.length === 0) {
    return;
  }

  const thoughtDisplay = parseThoughtDisplay(thoughtText);
  const thoughtKey = buildThoughtDedupKey(thoughtDisplay);
  if (state.seenThoughtKeys.has(thoughtKey)) {
    return;
  }

  state.seenThoughtKeys.add(thoughtKey);
  logger?.assistantThought(providerLabel, thoughtDisplay.title, thoughtDisplay.body);
}

async function readSseStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: SseEvent) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = '';

  const flushEventBlock = (block: string): void => {
    const lines = block
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      return;
    }

    const eventLine = lines.find((line) => line.startsWith('event:'));
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .filter((line) => line.length > 0 && line !== '[DONE]');

    if (data.length === 0) {
      return;
    }

    onEvent({
      event: eventLine ? eventLine.slice(6).trimStart() : undefined,
      data,
    });
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.search(/\r?\n\r?\n/);
    while (boundary !== -1) {
      const match = buffer.slice(boundary).match(/^\r?\n\r?\n/);
      const separatorLength = match?.[0]?.length ?? 2;
      flushEventBlock(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + separatorLength);
      boundary = buffer.search(/\r?\n\r?\n/);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim().length > 0) {
    flushEventBlock(buffer);
  }
}

function extractJsonObject(raw: string): ParsedObject {
  const trimmed = raw.trim();

  try {
    return JSON.parse(trimmed) as ParsedObject;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error('Birth draft did not return JSON.');
    }

    return JSON.parse(match[0]) as ParsedObject;
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item).trim()).filter((item) => item.length > 0);
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function toFlexibleStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return toStringArray(value);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return [];
}

function toOptionalProviderKey(value: unknown): ProviderKey | undefined {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';

  if (raw === 'openai') {
    return 'codex';
  }

  if (raw === 'anthropic') {
    return 'claude';
  }

  if (raw === 'github-copilot' || raw === 'github copilot') {
    return 'copilot';
  }

  return isProviderKey(raw) ? raw : undefined;
}

function toOptionalAuthMethod(value: unknown): AuthMethod | undefined {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return raw === 'api-key' || raw === 'cli' ? raw : undefined;
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function toBirthProfilePatch(value: unknown): Partial<AgentBirthProfile> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const payload = value as ParsedObject;
  const patch: Partial<AgentBirthProfile> = {
    purpose: toOptionalString(payload.purpose),
    personaRole: toOptionalString(payload.personaRole),
    personaTone: toOptionalString(payload.personaTone),
    personaSummary: toOptionalString(payload.personaSummary),
    soulMission: toOptionalString(payload.soulMission),
    soulEthos: toOptionalString(payload.soulEthos),
    soulGuardrails: toFlexibleStringArray(payload.soulGuardrails),
    systemPrompt: toOptionalString(payload.systemPrompt),
    styleRules: toFlexibleStringArray(payload.styleRules),
    workStylePlanningMode: toOptionalString(payload.workStylePlanningMode),
    workStyleApprovalPosture: toOptionalString(payload.workStyleApprovalPosture),
    workStyleCollaborationStyle: toOptionalString(payload.workStyleCollaborationStyle),
  };

  return Object.values(patch).some((entry) => entry !== undefined && entry !== '')
    ? patch
    : undefined;
}

function toBirthInterviewCapture(value: unknown): BirthInterviewCapture {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const payload = value as ParsedObject;
  return {
    agentName: toOptionalString(payload.agentName),
    agentSlug: toOptionalString(payload.agentSlug),
    agentId: toOptionalString(payload.agentId),
    scope: toOptionalString(payload.scope),
    operatorId: toOptionalString(payload.operatorId),
    operatorIds: toFlexibleStringArray(payload.operatorIds),
    selfRepository: toOptionalString(payload.selfRepository),
    assignedRepositories: toFlexibleStringArray(payload.assignedRepositories),
    provider: toOptionalProviderKey(payload.provider),
    providerAuthMethod: toOptionalAuthMethod(payload.providerAuthMethod),
    model: toOptionalString(payload.model),
    cognitiveMcpUrl: toOptionalString(payload.cognitiveMcpUrl),
    redisUrl: toOptionalString(payload.redisUrl),
    telegramEnabled: toOptionalBoolean(payload.telegramEnabled),
    telegramDefaultChatId: toOptionalString(payload.telegramDefaultChatId),
    telegramThreadId: toOptionalString(payload.telegramThreadId),
    telegramAllowTopicCommands: toOptionalBoolean(payload.telegramAllowTopicCommands),
    approvedNamespaces: toFlexibleStringArray(payload.approvedNamespaces),
    egressUrl: toFlexibleStringArray(payload.egressUrl),
    birthProfile: toBirthProfilePatch(payload.birthProfile),
  };
}

function toProfileDraft(payload: ParsedObject): Partial<AgentBirthProfile> {
  return {
    purpose: typeof payload.purpose === 'string' ? payload.purpose.trim() : undefined,
    personaRole:
      typeof payload.personaRole === 'string' ? payload.personaRole.trim() : undefined,
    personaTone:
      typeof payload.personaTone === 'string' ? payload.personaTone.trim() : undefined,
    personaSummary:
      typeof payload.personaSummary === 'string' ? payload.personaSummary.trim() : undefined,
    soulMission:
      typeof payload.soulMission === 'string' ? payload.soulMission.trim() : undefined,
    soulEthos: typeof payload.soulEthos === 'string' ? payload.soulEthos.trim() : undefined,
    soulGuardrails: toStringArray(payload.soulGuardrails),
    systemPrompt:
      typeof payload.systemPrompt === 'string' ? payload.systemPrompt.trim() : undefined,
    styleRules: toStringArray(payload.styleRules),
    workStylePlanningMode:
      typeof payload.workStylePlanningMode === 'string'
        ? payload.workStylePlanningMode.trim()
        : undefined,
    workStyleApprovalPosture:
      typeof payload.workStyleApprovalPosture === 'string'
        ? payload.workStyleApprovalPosture.trim()
        : undefined,
    workStyleCollaborationStyle:
      typeof payload.workStyleCollaborationStyle === 'string'
        ? payload.workStyleCollaborationStyle.trim()
        : undefined,
  };
}

function buildDraftPrompt(options: AgentBootstrapOptions): string {
  return JSON.stringify(
    {
      task: 'Create an operational birth profile for a Collab agent. Return JSON only.',
      output_schema: {
        purpose: 'string',
        personaRole: 'string',
        personaTone: 'string',
        personaSummary: 'string',
        soulMission: 'string',
        soulEthos: 'string',
        soulGuardrails: ['string'],
        systemPrompt: 'string',
        styleRules: ['string'],
        workStylePlanningMode: 'string',
        workStyleApprovalPosture: 'string',
        workStyleCollaborationStyle: 'string',
      },
      constraints: [
        'Be direct and operational.',
        'Do not invent product marketing language.',
        'Treat persona and soul as behavior-shaping instructions.',
        'Keep durable state behind agent.* and approved MCP boundaries.',
        'Mention the self repository and assigned repositories when relevant.',
        'Do not emit operator ids, Telegram routing fields, env vars, or secret placeholders. The CLI owns those values.',
      ],
      input: {
        agentName: options.agentName,
        agentId: options.agentId,
        scope: options.scope,
        runtimeSource: options.runtimeSource,
        provider: options.provider,
        providerAuthMethod: options.providerAuthMethod,
        model: options.model ?? null,
        selfRepository: options.selfRepository,
        assignedRepositories: options.assignedRepositories,
        approvedNamespaces: options.approvedNamespaces,
        operatorNamespaces: options.operatorNamespaces,
        cognitiveMcpUrl: options.cognitiveMcpUrl,
        egressUrls: options.egressUrls,
        existingBirthProfile: options.birthProfile,
      },
    },
    null,
    2,
  );
}

function buildInterviewPrompt(
  currentState: BirthInterviewCapture,
  transcript: readonly BirthInterviewMessage[],
): string {
  return JSON.stringify(
    {
      task:
        'Conduct the next turn of a conversational birth interview for a new Collab agent. Return JSON only.',
      skill: buildBirthInterviewSystemPrompt(),
      output_schema: {
        status: '"needs_input" | "complete"',
        assistantMessage: 'string',
        missing: ['string'],
        capture: {
          agentName: 'string?',
          agentSlug: 'string?',
          agentId: 'string?',
          scope: 'string?',
          selfRepository: 'string?',
          assignedRepositories: ['string'],
          provider: '"codex" | "claude" | "gemini" | "copilot"?',
          providerAuthMethod: '"api-key" | "cli"?',
          model: 'string?',
          cognitiveMcpUrl: 'string?',
          redisUrl: 'string?',
          approvedNamespaces: ['string'],
          egressUrl: ['string'],
          birthProfile: {
            purpose: 'string?',
            personaRole: 'string?',
            personaTone: 'string?',
            personaSummary: 'string?',
            soulMission: 'string?',
            soulEthos: 'string?',
            soulGuardrails: ['string'],
            systemPrompt: 'string?',
            styleRules: ['string'],
            workStylePlanningMode: 'string?',
            workStyleApprovalPosture: 'string?',
            workStyleCollaborationStyle: 'string?',
          },
        },
      },
      rules: [
        'Ask at most two targeted questions in assistantMessage.',
        'Do not ask the user to retype repository names already present in currentState.',
        'Do not ask for a model if providerAuthMethod is cli or provider is copilot.',
        'Treat Telegram as required operational infrastructure for the agent birth.',
        'Do not ask for raw secrets such as bot tokens or API keys. The CLI will collect them locally.',
        'Do not emit operator ids, Telegram routing fields, or any env/config variables in capture. The CLI owns those values.',
        'Treat role, purpose, soul, and durable boundaries as the highest-priority gaps.',
        'Do not set status to complete until telegramEnabled and the operator roster are known.',
        'Use safe defaults for low-risk fields when the user intent is already clear.',
        'When enough information exists to generate the birth package, set status to complete.',
      ],
      currentState,
      transcript,
    },
    null,
    2,
  );
}

function buildGeminiRequestBody(prompt: string, includeThoughts: boolean): string {
  return JSON.stringify({
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      ...(includeThoughts
        ? {
            thinkingConfig: {
              includeThoughts: true,
            },
          }
        : {}),
    },
  });
}

function extractGeminiParts(payload: GeminiGenerateContentPayload): GeminiResponsePart[] {
  return payload.candidates?.[0]?.content?.parts ?? [];
}

function appendGeminiParts(
  parts: GeminiResponsePart[],
  responseTexts: string[],
  logger: Logger | undefined,
  showThoughts: boolean,
  thoughtState: ThoughtRenderState,
): void {
  for (const part of parts) {
    const rawText = typeof part.text === 'string' ? part.text : '';
    if (rawText.length === 0) {
      continue;
    }

    if (part.thought === true) {
      const thoughtText = rawText.trim();
      if (thoughtText.length === 0) {
        continue;
      }

      if (!showThoughts) {
        continue;
      }

      emitThoughtIfNew('Gemini', thoughtText, logger, thoughtState);
      continue;
    }

    responseTexts.push(rawText);
  }
}

async function draftWithGemini(
  apiKey: string,
  model: string,
  prompt: string,
): Promise<Partial<AgentBirthProfile>> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: buildGeminiRequestBody(prompt, false),
    },
  );

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Gemini draft error (${response.status}): ${body}`);
  }

  const payload = JSON.parse(body) as GeminiGenerateContentPayload;
  const responseTexts: string[] = [];
  appendGeminiParts(
    extractGeminiParts(payload),
    responseTexts,
    undefined,
    false,
    { seenThoughtKeys: new Set() },
  );
  const responseText = responseTexts.join('').trim();

  return toProfileDraft(
    extractJsonObject(responseText || '{}'),
  );
}

async function generateJsonWithGemini(
  apiKey: string,
  model: string,
  prompt: string,
): Promise<ParsedObject> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: buildGeminiRequestBody(prompt, false),
    },
  );

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Gemini draft error (${response.status}): ${body}`);
  }

  const payload = JSON.parse(body) as GeminiGenerateContentPayload;
  const responseTexts: string[] = [];
  appendGeminiParts(
    extractGeminiParts(payload),
    responseTexts,
    undefined,
    false,
    { seenThoughtKeys: new Set() },
  );

  return extractJsonObject(responseTexts.join('').trim() || '{}');
}

async function draftWithGeminiStream(
  apiKey: string,
  model: string,
  prompt: string,
  logger?: Logger,
): Promise<Partial<AgentBirthProfile>> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: buildGeminiRequestBody(prompt, true),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini draft stream error (${response.status}): ${body}`);
  }

  if (!response.body) {
    return draftWithGemini(apiKey, model, prompt);
  }

  const responseTexts: string[] = [];
  const thoughtState: ThoughtRenderState = {
    seenThoughtKeys: new Set(),
  };
  await readSseStream(response.body, (event) => {
    for (const data of event.data) {
      const payload = JSON.parse(data) as GeminiGenerateContentPayload;
      appendGeminiParts(extractGeminiParts(payload), responseTexts, logger, true, thoughtState);
    }
  });

  return toProfileDraft(
    extractJsonObject(responseTexts.join('').trim() || '{}'),
  );
}

async function generateJsonWithGeminiStream(
  apiKey: string,
  model: string,
  prompt: string,
  logger?: Logger,
): Promise<ParsedObject> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: buildGeminiRequestBody(prompt, true),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini draft stream error (${response.status}): ${body}`);
  }

  if (!response.body) {
    return generateJsonWithGemini(apiKey, model, prompt);
  }

  const responseTexts: string[] = [];
  const thoughtState: ThoughtRenderState = {
    seenThoughtKeys: new Set(),
  };

  await readSseStream(response.body, (event) => {
    for (const data of event.data) {
      const payload = JSON.parse(data) as GeminiGenerateContentPayload;
      appendGeminiParts(extractGeminiParts(payload), responseTexts, logger, true, thoughtState);
    }
  });

  return extractJsonObject(responseTexts.join('').trim() || '{}');
}

function supportsOpenAiReasoningSummary(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized.startsWith('gpt-5')
    || normalized.startsWith('o1')
    || normalized.startsWith('o3')
    || normalized.startsWith('o4');
}

async function draftWithOpenAiStream(
  apiKey: string,
  model: string,
  prompt: string,
  logger?: Logger,
): Promise<Partial<AgentBirthProfile>> {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: prompt,
      instructions:
        'You generate Collab agent birth profiles. Return JSON only. Avoid markdown fences.',
      stream: true,
      ...(supportsOpenAiReasoningSummary(model)
        ? {
            reasoning: {
              summary: 'auto',
            },
          }
        : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI draft stream error (${response.status}): ${body}`);
  }

  if (!response.body) {
    return draftWithOpenAiCompatible(
      'https://api.openai.com',
      apiKey,
      model,
      prompt,
      'OpenAI',
    );
  }

  const responseTexts: string[] = [];
  const reasoningBuffers = new Map<string, string>();
  const thoughtState: ThoughtRenderState = { seenThoughtKeys: new Set() };

  await readSseStream(response.body, (event) => {
    for (const data of event.data) {
      const payload = JSON.parse(data) as Record<string, unknown>;
      const type = typeof payload.type === 'string' ? payload.type : event.event;

      if (type === 'response.output_text.delta') {
        const delta = typeof payload.delta === 'string' ? payload.delta : '';
        if (delta.length > 0) {
          responseTexts.push(delta);
        }
        continue;
      }

      if (type === 'response.reasoning_summary_text.delta') {
        const key = String(payload.item_id ?? payload.output_index ?? payload.content_index ?? 'default');
        const delta = typeof payload.delta === 'string' ? payload.delta : '';
        reasoningBuffers.set(key, `${reasoningBuffers.get(key) ?? ''}${delta}`);
        continue;
      }

      if (type === 'response.reasoning_summary_text.done') {
        const key = String(payload.item_id ?? payload.output_index ?? payload.content_index ?? 'default');
        const finalText =
          typeof payload.text === 'string'
            ? payload.text
            : reasoningBuffers.get(key) ?? '';
        emitThoughtIfNew('OpenAI', finalText, logger, thoughtState);
        reasoningBuffers.delete(key);
        continue;
      }

      if (type === 'response.completed' && responseTexts.length === 0) {
        const completed = payload as OpenAiResponsesCompletedEvent;
        const completedText = completed.response?.output
          ?.flatMap((item) => item.content ?? [])
          .filter((item) => item.type === 'output_text' && typeof item.text === 'string')
          .map((item) => item.text ?? '')
          .join('');

        if (completedText && completedText.length > 0) {
          responseTexts.push(completedText);
        }
      }
    }
  });

  return toProfileDraft(extractJsonObject(responseTexts.join('').trim() || '{}'));
}

async function generateJsonWithOpenAiStream(
  apiKey: string,
  model: string,
  prompt: string,
  logger?: Logger,
): Promise<ParsedObject> {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: prompt,
      instructions:
        'You generate Collab agent birth artifacts. Return JSON only. Avoid markdown fences.',
      stream: true,
      ...(supportsOpenAiReasoningSummary(model)
        ? {
            reasoning: {
              summary: 'auto',
            },
          }
        : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI draft stream error (${response.status}): ${body}`);
  }

  if (!response.body) {
    return generateJsonWithOpenAiCompatible(
      'https://api.openai.com',
      apiKey,
      model,
      prompt,
      'OpenAI',
    );
  }

  const responseTexts: string[] = [];
  const reasoningBuffers = new Map<string, string>();
  const thoughtState: ThoughtRenderState = { seenThoughtKeys: new Set() };

  await readSseStream(response.body, (event) => {
    for (const data of event.data) {
      const payload = JSON.parse(data) as Record<string, unknown>;
      const type = typeof payload.type === 'string' ? payload.type : event.event;

      if (type === 'response.output_text.delta') {
        const delta = typeof payload.delta === 'string' ? payload.delta : '';
        if (delta.length > 0) {
          responseTexts.push(delta);
        }
        continue;
      }

      if (type === 'response.reasoning_summary_text.delta') {
        const key = String(payload.item_id ?? payload.output_index ?? payload.content_index ?? 'default');
        const delta = typeof payload.delta === 'string' ? payload.delta : '';
        reasoningBuffers.set(key, `${reasoningBuffers.get(key) ?? ''}${delta}`);
        continue;
      }

      if (type === 'response.reasoning_summary_text.done') {
        const key = String(payload.item_id ?? payload.output_index ?? payload.content_index ?? 'default');
        const finalText =
          typeof payload.text === 'string'
            ? payload.text
            : reasoningBuffers.get(key) ?? '';
        emitThoughtIfNew('OpenAI', finalText, logger, thoughtState);
        reasoningBuffers.delete(key);
        continue;
      }

      if (type === 'response.completed' && responseTexts.length === 0) {
        const completed = payload as OpenAiResponsesCompletedEvent;
        const completedText = completed.response?.output
          ?.flatMap((item) => item.content ?? [])
          .filter((item) => item.type === 'output_text' && typeof item.text === 'string')
          .map((item) => item.text ?? '')
          .join('');

        if (completedText && completedText.length > 0) {
          responseTexts.push(completedText);
        }
      }
    }
  });

  return extractJsonObject(responseTexts.join('').trim() || '{}');
}

async function draftWithOpenAiCompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  providerLabel: string,
): Promise<Partial<AgentBirthProfile>> {
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'You generate Collab agent birth profiles. Return JSON only. Avoid markdown fences.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${providerLabel} draft error (${response.status}): ${body}`);
  }

  const payload = JSON.parse(body) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return toProfileDraft(extractJsonObject(payload.choices?.[0]?.message?.content ?? '{}'));
}

async function generateJsonWithOpenAiCompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  providerLabel: string,
): Promise<ParsedObject> {
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'You generate Collab agent birth artifacts. Return JSON only. Avoid markdown fences.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${providerLabel} draft error (${response.status}): ${body}`);
  }

  const payload = JSON.parse(body) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return extractJsonObject(payload.choices?.[0]?.message?.content ?? '{}');
}

async function draftWithAnthropic(
  apiKey: string,
  model: string,
  prompt: string,
): Promise<Partial<AgentBirthProfile>> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      system:
        'You generate Collab agent birth profiles. Return JSON only. Avoid markdown fences.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Anthropic draft error (${response.status}): ${body}`);
  }

  const payload = JSON.parse(body) as {
    content?: Array<{ type: string; text?: string }>;
  };

  const text = payload.content?.find((entry) => entry.type === 'text')?.text ?? '{}';
  return toProfileDraft(extractJsonObject(text));
}

async function generateJsonWithAnthropic(
  apiKey: string,
  model: string,
  prompt: string,
): Promise<ParsedObject> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      system: 'You generate Collab agent birth artifacts. Return JSON only. Avoid markdown fences.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Anthropic draft error (${response.status}): ${body}`);
  }

  const payload = JSON.parse(body) as {
    content?: Array<{ type: string; text?: string }>;
  };

  const text = payload.content?.find((entry) => entry.type === 'text')?.text ?? '{}';
  return extractJsonObject(text);
}

function supportsAnthropicThinking(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized.startsWith('claude-sonnet-4')
    || normalized.startsWith('claude-opus-4')
    || normalized.startsWith('claude-3-7-sonnet');
}

async function draftWithAnthropicStream(
  apiKey: string,
  model: string,
  prompt: string,
  logger?: Logger,
): Promise<Partial<AgentBirthProfile>> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: supportsAnthropicThinking(model) ? 4096 : 2000,
      stream: true,
      ...(supportsAnthropicThinking(model)
        ? {
            thinking: {
              type: 'enabled',
              budget_tokens: 1024,
            },
          }
        : {}),
      system:
        'You generate Collab agent birth profiles. Return JSON only. Avoid markdown fences.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic draft stream error (${response.status}): ${body}`);
  }

  if (!response.body) {
    return draftWithAnthropic(apiKey, model, prompt);
  }

  const blocks = new Map<number, { type: string; text: string }>();
  const thoughtState: ThoughtRenderState = { seenThoughtKeys: new Set() };

  await readSseStream(response.body, (event) => {
    for (const data of event.data) {
      const payload = JSON.parse(data) as Record<string, unknown>;
      const type = typeof payload.type === 'string' ? payload.type : event.event;

      if (type === 'content_block_start') {
        const index = Number(payload.index ?? 0);
        const contentBlock = payload.content_block as Record<string, unknown> | undefined;
        const blockType =
          typeof contentBlock?.type === 'string'
            ? contentBlock.type
            : 'text';
        const seedText =
          typeof contentBlock?.text === 'string'
            ? contentBlock.text
            : typeof contentBlock?.thinking === 'string'
              ? contentBlock.thinking
              : '';
        blocks.set(index, { type: blockType, text: seedText });
        continue;
      }

      if (type === 'content_block_delta') {
        const index = Number(payload.index ?? 0);
        const current = blocks.get(index) ?? { type: 'text', text: '' };
        const delta = payload.delta as Record<string, unknown> | undefined;
        if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
          current.type = 'thinking';
          current.text += delta.thinking;
        } else if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          current.type = 'text';
          current.text += delta.text;
        }
        blocks.set(index, current);
        continue;
      }

      if (type === 'content_block_stop') {
        const index = Number(payload.index ?? 0);
        const block = blocks.get(index);
        if (block?.type === 'thinking') {
          emitThoughtIfNew('Anthropic', block.text, logger, thoughtState);
        }
      }
    }
  });

  const responseText = [...blocks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, block]) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim();

  return toProfileDraft(extractJsonObject(responseText || '{}'));
}

async function generateJsonWithAnthropicStream(
  apiKey: string,
  model: string,
  prompt: string,
  logger?: Logger,
): Promise<ParsedObject> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: supportsAnthropicThinking(model) ? 4096 : 2000,
      stream: true,
      ...(supportsAnthropicThinking(model)
        ? {
            thinking: {
              type: 'enabled',
              budget_tokens: 1024,
            },
          }
        : {}),
      system: 'You generate Collab agent birth artifacts. Return JSON only. Avoid markdown fences.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic draft stream error (${response.status}): ${body}`);
  }

  if (!response.body) {
    return generateJsonWithAnthropic(apiKey, model, prompt);
  }

  const blocks = new Map<number, { type: string; text: string }>();
  const thoughtState: ThoughtRenderState = { seenThoughtKeys: new Set() };

  await readSseStream(response.body, (event) => {
    for (const data of event.data) {
      const payload = JSON.parse(data) as Record<string, unknown>;
      const type = typeof payload.type === 'string' ? payload.type : event.event;

      if (type === 'content_block_start') {
        const index = Number(payload.index ?? 0);
        const contentBlock = payload.content_block as Record<string, unknown> | undefined;
        const blockType =
          typeof contentBlock?.type === 'string'
            ? contentBlock.type
            : 'text';
        const seedText =
          typeof contentBlock?.text === 'string'
            ? contentBlock.text
            : typeof contentBlock?.thinking === 'string'
              ? contentBlock.thinking
              : '';
        blocks.set(index, { type: blockType, text: seedText });
        continue;
      }

      if (type === 'content_block_delta') {
        const index = Number(payload.index ?? 0);
        const current = blocks.get(index) ?? { type: 'text', text: '' };
        const delta = payload.delta as Record<string, unknown> | undefined;
        if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
          current.type = 'thinking';
          current.text += delta.thinking;
        } else if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          current.type = 'text';
          current.text += delta.text;
        }
        blocks.set(index, current);
        continue;
      }

      if (type === 'content_block_stop') {
        const index = Number(payload.index ?? 0);
        const block = blocks.get(index);
        if (block?.type === 'thinking') {
          emitThoughtIfNew('Anthropic', block.text, logger, thoughtState);
        }
      }
    }
  });

  const responseText = [...blocks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, block]) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim();

  return extractJsonObject(responseText || '{}');
}

function selectBirthLlmProvider(preferredProvider: ProviderKey) {
  return detectBirthLlmProviders(preferredProvider)[0] ?? null;
}

async function generateJsonWithSelectedProvider(
  selected: NonNullable<ReturnType<typeof selectBirthLlmProvider>>,
  prompt: string,
  logger: Logger,
  interactiveSession: boolean,
): Promise<ParsedObject> {
  if (selected.provider === 'gemini') {
    return interactiveSession
      ? generateJsonWithGeminiStream(selected.apiKey, selected.model, prompt, logger)
      : generateJsonWithGemini(selected.apiKey, selected.model, prompt);
  }

  if (selected.provider === 'openai') {
    return interactiveSession
      ? generateJsonWithOpenAiStream(selected.apiKey, selected.model, prompt, logger)
      : generateJsonWithOpenAiCompatible(
          'https://api.openai.com',
          selected.apiKey,
          selected.model,
          prompt,
          'OpenAI',
        );
  }

  if (selected.provider === 'xai') {
    return generateJsonWithOpenAiCompatible(
      'https://api.x.ai',
      selected.apiKey,
      selected.model,
      prompt,
      'xAI',
    );
  }

  return interactiveSession
    ? generateJsonWithAnthropicStream(selected.apiKey, selected.model, prompt, logger)
    : generateJsonWithAnthropic(selected.apiKey, selected.model, prompt);
}

function toBirthInterviewTurn(payload: BirthInterviewPayload): BirthInterviewTurn {
  return {
    status: payload.status === 'complete' ? 'complete' : 'needs_input',
    assistantMessage:
      toOptionalString(payload.assistantMessage)
      ?? 'Describe the agent you want to create, what it should do, and what kind of work it will own.',
    missing: toFlexibleStringArray(payload.missing),
    capture: toBirthInterviewCapture(payload.capture),
  };
}

export function createBirthDraftAssistant(
  logger: Logger,
  assistantOptions: BirthDraftAssistantOptions = {},
): BirthDraftAssistant {
  return {
    async draftProfile(options) {
      const selected = selectBirthLlmProvider(options.provider);

      if (!selected) {
        return null;
      }

      logger.debug(
        `Using ${selected.label} birth draft assistant via ${selected.apiKeyEnvVar} (${selected.model}).`,
      );

      const prompt = buildDraftPrompt(options);
      return toProfileDraft(
        await generateValidatedJsonWithSelectedProvider(
          selected,
          prompt,
          logger,
          Boolean(assistantOptions.interactiveSession),
          validateBirthDraftPayload,
          'birth draft',
        ),
      );
    },
  };
}

export function createBirthInterviewAssistant(
  logger: Logger,
  assistantOptions: BirthDraftAssistantOptions = {},
): BirthInterviewAssistant {
  return {
    async planTurn(preferredProvider, currentState, transcript) {
      const selected = selectBirthLlmProvider(preferredProvider);

      if (!selected) {
        return null;
      }

      logger.debug(
        `Using ${selected.label} conversational birth interview via ${selected.apiKeyEnvVar} (${selected.model}).`,
      );

      const prompt = buildInterviewPrompt(currentState, transcript);
      const payload = await generateValidatedJsonWithSelectedProvider(
        selected,
        prompt,
        logger,
        Boolean(assistantOptions.interactiveSession),
        validateBirthInterviewPayload,
        'birth interview',
      );

      return toBirthInterviewTurn(payload as BirthInterviewPayload);
    },
  };
}
