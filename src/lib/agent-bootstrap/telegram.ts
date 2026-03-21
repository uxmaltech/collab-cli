import type { Logger } from '../logger';
import type { BirthPromptAdapter } from './wizard';

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
}

interface TelegramMessageLike {
  message_id?: number;
  message_thread_id?: number;
  text?: string;
  caption?: string;
  chat?: TelegramChat;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessageLike;
  edited_message?: TelegramMessageLike;
  channel_post?: TelegramMessageLike;
  edited_channel_post?: TelegramMessageLike;
  my_chat_member?: {
    chat?: TelegramChat;
  };
  chat_member?: {
    chat?: TelegramChat;
  };
}

interface TelegramBotUser {
  id: number;
  username?: string;
  first_name?: string;
}

const BINDING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TELEGRAM_BINDING_POLL_INTERVAL_MS = 3000;
const TELEGRAM_BINDING_MAX_POLLS = 15;

export interface TelegramThreadCandidate {
  id: string;
  label: string;
  excerpt?: string;
  bindingSignal?: boolean;
  lastUpdateId?: number;
}

export interface TelegramChatCandidate {
  id: string;
  label: string;
  type: string;
  threads: TelegramThreadCandidate[];
  bindingSignal?: boolean;
  lastUpdateId?: number;
}

export interface TelegramDiscoveryResult {
  botLabel: string;
  chats: TelegramChatCandidate[];
  latestUpdateId: number;
}

function sanitizeToken(token: string): string {
  return token.trim();
}

function buildBotApiUrl(token: string, method: string): string {
  return `https://api.telegram.org/bot${encodeURIComponent(sanitizeToken(token))}/${method}`;
}

async function telegramGet<T>(token: string, method: string, query?: URLSearchParams): Promise<T> {
  const url = new URL(buildBotApiUrl(token, method));
  if (query) {
    url.search = query.toString();
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Telegram ${method} failed (${response.status}): ${body}`);
  }

  const payload = JSON.parse(body) as TelegramApiResponse<T>;
  if (!payload.ok || payload.result === undefined) {
    throw new Error(`Telegram ${method} failed: ${payload.description ?? 'Unknown error'}`);
  }

  return payload.result;
}

function messageLikeFromUpdate(update: TelegramUpdate): TelegramMessageLike | undefined {
  return update.message
    ?? update.edited_message
    ?? update.channel_post
    ?? update.edited_channel_post;
}

function chatLabel(chat: TelegramChat): string {
  return chat.title?.trim()
    || (chat.username ? `@${chat.username}` : '')
    || String(chat.id);
}

function threadLabel(threadId: number, excerpt?: string): string {
  const trimmedExcerpt = excerpt?.trim();
  if (trimmedExcerpt) {
    return `Thread ${threadId} · ${trimmedExcerpt.slice(0, 48)}`;
  }

  return `Thread ${threadId}`;
}

function extractExcerpt(message: TelegramMessageLike): string | undefined {
  return message.text?.trim() || message.caption?.trim() || undefined;
}

function createBindingCode(length = 4): string {
  let code = '';
  for (let index = 0; index < length; index += 1) {
    const randomIndex = Math.floor(Math.random() * BINDING_CODE_ALPHABET.length);
    code += BINDING_CODE_ALPHABET[randomIndex];
  }
  return code;
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function hasBindingSignal(message: TelegramMessageLike, bindingCode?: string): boolean {
  const excerpt = extractExcerpt(message);
  if (!excerpt) {
    return false;
  }

  if (bindingCode) {
    const escapedCode = bindingCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`/collab-bind\\s+${escapedCode}\\b`, 'i').test(excerpt);
  }

  return /\/collab-bind\b/i.test(excerpt);
}

function sortThreads(threads: TelegramThreadCandidate[]): TelegramThreadCandidate[] {
  return [...threads].sort((left, right) => {
    const bindingDelta = Number(Boolean(right.bindingSignal)) - Number(Boolean(left.bindingSignal));
    if (bindingDelta !== 0) {
      return bindingDelta;
    }

    const updateDelta = (right.lastUpdateId ?? 0) - (left.lastUpdateId ?? 0);
    if (updateDelta !== 0) {
      return updateDelta;
    }

    return left.label.localeCompare(right.label);
  });
}

function sortChats(chats: TelegramChatCandidate[]): TelegramChatCandidate[] {
  return [...chats].sort((left, right) => {
    const bindingDelta = Number(Boolean(right.bindingSignal)) - Number(Boolean(left.bindingSignal));
    if (bindingDelta !== 0) {
      return bindingDelta;
    }

    const updateDelta = (right.lastUpdateId ?? 0) - (left.lastUpdateId ?? 0);
    if (updateDelta !== 0) {
      return updateDelta;
    }

    return left.label.localeCompare(right.label);
  });
}

export async function discoverTelegramTargets(
  token: string,
  options: { offset?: number; bindingCode?: string } = {},
): Promise<TelegramDiscoveryResult> {
  const bot = await telegramGet<TelegramBotUser>(token, 'getMe');
  const query = new URLSearchParams({
    limit: '100',
    allowed_updates: JSON.stringify([
      'message',
      'edited_message',
      'channel_post',
      'edited_channel_post',
      'my_chat_member',
      'chat_member',
    ]),
  });
  if (typeof options.offset === 'number' && Number.isFinite(options.offset)) {
    query.set('offset', String(options.offset));
  }
  const updates = await telegramGet<TelegramUpdate[]>(token, 'getUpdates', query);

  const chats = new Map<string, TelegramChatCandidate>();
  let latestUpdateId = typeof options.offset === 'number' ? options.offset - 1 : 0;

  const ensureChat = (chat: TelegramChat): TelegramChatCandidate => {
    const id = String(chat.id);
    const existing = chats.get(id);
    if (existing) {
      return existing;
    }

    const candidate: TelegramChatCandidate = {
      id,
      label: chatLabel(chat),
      type: chat.type,
      threads: [],
    };
    chats.set(id, candidate);
    return candidate;
  };

  for (const update of updates) {
    latestUpdateId = Math.max(latestUpdateId, update.update_id);
    const message = messageLikeFromUpdate(update);
    const messageChat = message?.chat;
    if (messageChat && ['group', 'supergroup', 'channel'].includes(messageChat.type)) {
      const candidate = ensureChat(messageChat);
      candidate.lastUpdateId = Math.max(candidate.lastUpdateId ?? 0, update.update_id);
      if (message && hasBindingSignal(message, options.bindingCode)) {
        candidate.bindingSignal = true;
      }
      if (typeof message?.message_thread_id === 'number') {
        const threadId = String(message.message_thread_id);
        const existingThread = candidate.threads.find((thread) => thread.id === threadId);
        const excerpt = extractExcerpt(message);
        if (existingThread) {
          existingThread.excerpt = excerpt ?? existingThread.excerpt;
          existingThread.label = threadLabel(message.message_thread_id, excerpt ?? existingThread.excerpt);
          existingThread.lastUpdateId = Math.max(existingThread.lastUpdateId ?? 0, update.update_id);
          existingThread.bindingSignal =
            existingThread.bindingSignal || (message ? hasBindingSignal(message, options.bindingCode) : false);
        } else {
          candidate.threads.push({
            id: threadId,
            label: threadLabel(message.message_thread_id, excerpt),
            excerpt,
            lastUpdateId: update.update_id,
            bindingSignal: message ? hasBindingSignal(message, options.bindingCode) : false,
          });
        }
      }
    }

    const membershipChat = update.my_chat_member?.chat ?? update.chat_member?.chat;
    if (membershipChat && ['group', 'supergroup', 'channel'].includes(membershipChat.type)) {
      ensureChat(membershipChat);
    }
  }

  return {
    botLabel: bot.username ? `@${bot.username}` : bot.first_name || String(bot.id),
    chats: sortChats(
      [...chats.values()].map((chat) => ({
        ...chat,
        threads: sortThreads(chat.threads),
      })),
    ),
    latestUpdateId,
  };
}

export interface ResolveTelegramRoutingOptions {
  logger?: Logger;
  prompt: BirthPromptAdapter;
}

export interface TelegramRouting {
  chatId: string;
  threadId: string;
}

function tryAutoResolveRoutingFromDiscovery(
  discovery: TelegramDiscoveryResult,
): TelegramRouting | undefined {
  const bindingMatches = extractBindingMatches(discovery);
  const candidateSource =
    bindingMatches.chats.length > 0
      ? bindingMatches
      : discovery;
  const chatsWithThreads = candidateSource.chats.filter((chat) => chat.threads.length > 0);

  if (chatsWithThreads.length !== 1) {
    return undefined;
  }

  const [chat] = chatsWithThreads;
  if (chat.threads.length !== 1) {
    return undefined;
  }

  return {
    chatId: chat.id,
    threadId: chat.threads[0].id,
  };
}

export async function tryAutoResolveTelegramRouting(
  token: string,
  options: { logger?: Logger } = {},
): Promise<TelegramRouting | undefined> {
  const discovery = await discoverTelegramTargets(token);
  options.logger?.info(`Telegram bot validated as ${discovery.botLabel}.`);
  const autoResolved = tryAutoResolveRoutingFromDiscovery(discovery);
  if (autoResolved) {
    options.logger?.info(
      `Resolved Telegram team thread automatically as ${autoResolved.chatId}/${autoResolved.threadId}.`,
    );
  }
  return autoResolved;
}

export async function resolveTelegramRouting(
  token: string,
  options: ResolveTelegramRoutingOptions,
): Promise<TelegramRouting> {
  const { logger, prompt } = options;
  const initialDiscovery = await discoverTelegramTargets(token);
  logger?.info(`Telegram bot validated as ${initialDiscovery.botLabel}.`);

  let highestSeenUpdateId = initialDiscovery.latestUpdateId;
  const initialRouting = await tryResolveDiscoveredRouting(initialDiscovery, prompt, logger, false);
  if (initialRouting) {
    return initialRouting;
  }

  const bindingCode = createBindingCode();
  logger?.info(
    initialDiscovery.chats.length > 0
      ? `Send /collab-bind ${bindingCode} in the exact Telegram group/topic for this agent. I will check Telegram automatically every 3 seconds.`
      : `I could not find recent Telegram activity for this bot. Send /collab-bind ${bindingCode} in the target Telegram group/topic. I will check Telegram automatically every 3 seconds.`,
  );

  while (true) {
    for (let pollIndex = 0; pollIndex < TELEGRAM_BINDING_MAX_POLLS; pollIndex += 1) {
      if (pollIndex > 0) {
        await sleep(TELEGRAM_BINDING_POLL_INTERVAL_MS);
      }

      logger?.debug(
        `Checking Telegram for /collab-bind ${bindingCode} (${pollIndex + 1}/${TELEGRAM_BINDING_MAX_POLLS})...`,
      );
      const freshDiscovery = await discoverTelegramTargets(token, {
        offset: highestSeenUpdateId > 0 ? highestSeenUpdateId + 1 : undefined,
        bindingCode,
      });
      highestSeenUpdateId = Math.max(highestSeenUpdateId, freshDiscovery.latestUpdateId);

      const bindingMatches = extractBindingMatches(freshDiscovery);
      if (bindingMatches.chats.length === 0) {
        continue;
      }

      const freshRouting = await tryResolveDiscoveredRouting(bindingMatches, prompt, logger, true);
      if (freshRouting) {
        return freshRouting;
      }
    }

    logger?.warn(`No Telegram update matched /collab-bind ${bindingCode} yet.`);
    const nextAction = await prompt.choice(
      'Telegram binding was not detected yet. What should I do?',
      [
        {
          value: 'continue',
          label: 'Keep waiting',
          description: 'Continue polling Telegram for the binding command',
        },
        {
          value: 'manual',
          label: 'Enter manually',
          description: 'Type the Telegram chat id and optional topic id yourself',
        },
      ],
      'continue',
    );

    if (nextAction === 'continue') {
      continue;
    }

    break;
  }

  if (initialDiscovery.chats.length > 0) {
    logger?.info('Falling back to the Telegram chats already discovered for this bot.');
    const fallbackRouting = await tryResolveDiscoveredRouting(initialDiscovery, prompt, logger, true);
    if (fallbackRouting) {
      return fallbackRouting;
    }
  }

  const manualChatId = await prompt.text('Telegram default chat id');
  const manualThreadId = await prompt.text('Telegram thread id (optional)', '');
  return {
    chatId: manualChatId.trim(),
    threadId: manualThreadId.trim(),
  };
}

async function resolveTelegramChatThreads(
  selectedChat: TelegramChatCandidate,
  prompt: BirthPromptAdapter,
  logger?: Logger,
): Promise<TelegramRouting> {
  if (selectedChat.threads.length === 1) {
    logger?.info(`Using Telegram chat ${selectedChat.label} and ${selectedChat.threads[0].label}.`);
    return {
      chatId: selectedChat.id,
      threadId: selectedChat.threads[0].id,
    };
  }

  if (selectedChat.threads.length > 1) {
    const selectedThreadId = await prompt.choice(
      'Select Telegram topic',
      selectedChat.threads.map((thread) => ({
        value: thread.id,
        label: thread.label,
        description: thread.excerpt,
      })),
      selectedChat.threads[0].id,
    );
    return {
      chatId: selectedChat.id,
      threadId: selectedThreadId,
    };
  }

  if (selectedChat.bindingSignal) {
    logger?.info(`Using Telegram chat ${selectedChat.label} without a topic id.`);
    return {
      chatId: selectedChat.id,
      threadId: '',
    };
  }

  const manualThreadId = await prompt.text('Telegram thread id (optional)', '');
  return {
    chatId: selectedChat.id,
    threadId: manualThreadId.trim(),
  };
}

async function tryResolveDiscoveredRouting(
  discovery: TelegramDiscoveryResult,
  prompt: BirthPromptAdapter,
  logger: Logger | undefined,
  allowSelection: boolean,
): Promise<TelegramRouting | undefined> {
  if (discovery.chats.length === 0) {
    return undefined;
  }

  if (discovery.chats.length === 1) {
    if (!allowSelection && discovery.chats[0].threads.length === 0) {
      return undefined;
    }

    try {
      return await resolveTelegramChatThreads(discovery.chats[0], prompt, logger);
    } catch (error) {
      if (error instanceof Error && error.message === 'TELEGRAM_RETRY_DISCOVERY') {
        return undefined;
      }
      throw error;
    }
  }

  if (!allowSelection) {
    return undefined;
  }

  const selectedChatId = await prompt.choice(
    'Select Telegram chat',
    discovery.chats.map((chat) => ({
      value: chat.id,
      label: chat.label,
      description: `${chat.type}${chat.threads.length > 0 ? ` · ${chat.threads.length} topic(s)` : ''}`,
    })),
    discovery.chats[0].id,
  );
  const selectedChat = discovery.chats.find((chat) => chat.id === selectedChatId);
  if (!selectedChat) {
    throw new Error(`Selected Telegram chat '${selectedChatId}' was not found.`);
  }

  try {
    return await resolveTelegramChatThreads(selectedChat, prompt, logger);
  } catch (error) {
    if (error instanceof Error && error.message === 'TELEGRAM_RETRY_DISCOVERY') {
      return undefined;
    }
    throw error;
  }
}

function extractBindingMatches(discovery: TelegramDiscoveryResult): TelegramDiscoveryResult {
  const matchedChats: TelegramChatCandidate[] = [];

  for (const chat of discovery.chats) {
    const matchedThreads = chat.threads.filter((thread) => thread.bindingSignal);
    if (matchedThreads.length > 0) {
      matchedChats.push({
        ...chat,
        bindingSignal: true,
        threads: matchedThreads,
      });
      continue;
    }

    if (chat.bindingSignal) {
      matchedChats.push({
        ...chat,
        threads: [],
      });
    }
  }

  return {
    ...discovery,
    chats: sortChats(matchedChats),
  };
}
