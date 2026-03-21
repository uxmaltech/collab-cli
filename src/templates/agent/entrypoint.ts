import type { AgentBootstrapOptions } from '../../lib/agent-bootstrap/types';

export function agentEntrypointTemplate(options: AgentBootstrapOptions): string {
  const assignedRepositories = JSON.stringify(options.assignedRepositories);
  const systemPrompt = JSON.stringify(options.birthProfile.systemPrompt);
  const turnPrompt = JSON.stringify(
    `Run one visible turn for ${options.agentName}: load identity, create or retrieve the project for ${options.selfRepository}, create the bootstrap task${options.assignedRepositories.length > 0 ? ` scoped to ${options.assignedRepositories.join(', ')}` : ''}, append the memory fact, checkpoint the session, persist all durable state in the cognitive infrastructure, and summarize the visible artifacts produced.`,
  );

  return `#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const AGENT_NAME = ${JSON.stringify(options.agentName)};
const AGENT_ID = ${JSON.stringify(options.agentId)};
const AGENT_SCOPE = ${JSON.stringify(options.scope)};
const SELF_REPOSITORY = ${JSON.stringify(options.selfRepository)};
const ASSIGNED_REPOSITORIES = ${assignedRepositories};
const SYSTEM_PROMPT = ${systemPrompt};
const TURN_PROMPT = ${turnPrompt};
const OPERATOR_ID = ${JSON.stringify(options.operatorId)};
const OPERATOR_IDS = ${JSON.stringify(options.operatorIds)};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\\r?\\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1);
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function writeRuntimeSession(runtimeDir, payload) {
  ensureDirectory(runtimeDir);
  const sessionPath = path.join(runtimeDir, 'last-session.json');
  fs.writeFileSync(sessionPath, JSON.stringify(payload, null, 2) + '\\n', 'utf8');
  return sessionPath;
}

function printSummary(label, entries) {
  process.stdout.write(label + '\\n');
  for (const [key, value] of entries) {
    process.stdout.write('  - ' + key + ': ' + value + '\\n');
  }
}

function main() {
  const workspaceDir = process.cwd();
  const envPath = path.join(workspaceDir, '.env');
  readEnvFile(envPath);

  const configPath = path.join(workspaceDir, '.collab', 'config.json');
  const config = readJson(configPath);
  const birthPath = path.join(workspaceDir, config.agent.birth.birthFile);
  const promptsPath = path.join(workspaceDir, config.agent.birth.visiblePromptsFile);
  const birth = readJson(birthPath);
  const visiblePrompts = readJson(promptsPath);

  const [mode = 'development', ...restArgs] = process.argv.slice(2);
  const runtimeDir = path.join(workspaceDir, '.collab', 'runtime');
  const payload = {
    startedAt: new Date().toISOString(),
    pid: process.pid,
    mode,
    args: restArgs,
    workspaceDir,
    agent: {
      id: AGENT_ID,
      name: AGENT_NAME,
      scope: AGENT_SCOPE,
      selfRepository: SELF_REPOSITORY,
      assignedRepositories: ASSIGNED_REPOSITORIES,
      provider: config.agent.defaultProvider,
      providerAuthMethod: config.agent.defaultProviderAuthMethod,
    },
    runtime: {
      cognitiveMcpUrl: config.agent.mcp.cognitive.serverUrl,
      redisUrl: config.agent.redisUrl,
      durableStateBackend: config.agent.persistence?.durableStateBackend,
      telegram: {
        botConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
        defaultChatId: process.env.TELEGRAM_DEFAULT_CHAT_ID || '',
        threadId: process.env.TELEGRAM_THREAD_ID || '',
        operationalOutputMode: config.agent.notifications?.telegram?.operationalOutput?.mode || 'disabled',
        teamSummaryMode: config.agent.notifications?.telegram?.teamSummary?.mode || 'disabled',
        allowTopicCommands: Boolean(config.agent.notifications?.telegram?.commandIngress?.allowTopicCommands),
        operatorProfileId:
          config.agent.notifications?.telegram?.operationalOutput?.primaryOperatorProfileId
          || OPERATOR_ID,
        operatorProfileIds:
          config.agent.notifications?.telegram?.operationalOutput?.operatorProfileIds
          || OPERATOR_IDS,
      },
    },
    prompt: {
      system: birth.prompt_profile?.system_prompt || SYSTEM_PROMPT,
      development: visiblePrompts.visible_prompts?.turn_execute?.prompt || TURN_PROMPT,
    },
  };
  const sessionPath = writeRuntimeSession(runtimeDir, payload);

  if (mode === 'inspect') {
    process.stdout.write(JSON.stringify({ ...payload, sessionPath }, null, 2) + '\\n');
    return;
  }

  const telegramOperationalRouting =
    payload.runtime.telegram.operationalOutputMode === 'originating-operator'
      ? ('operator dm via ' + payload.runtime.telegram.operatorProfileId)
      : '(not configured)';
  const telegramSummaryRouting =
    payload.runtime.telegram.teamSummaryMode === 'thread'
      ? ((process.env.TELEGRAM_DEFAULT_CHAT_ID || '(missing chat)') + '/' + (process.env.TELEGRAM_THREAD_ID || '(missing thread)'))
      : '(disabled)';

  printSummary('Collab agent runtime session', [
    ['agent', AGENT_NAME + ' (' + AGENT_ID + ')'],
    ['mode', mode],
    ['workspace', workspaceDir],
    ['self repo', SELF_REPOSITORY],
    ['assigned repos', ASSIGNED_REPOSITORIES.join(', ') || '(none)'],
    ['provider', config.agent.defaultProvider + (config.agent.defaultModel ? ' (' + config.agent.defaultModel + ')' : '')],
    ['cognitive mcp', config.agent.mcp.cognitive.serverUrl],
    ['redis', config.agent.redisUrl],
    ['operators', payload.runtime.telegram.operatorProfileIds.join(', ') || payload.runtime.telegram.operatorProfileId],
    ['telegram command ingress', payload.runtime.telegram.allowTopicCommands ? 'dm-or-thread' : 'dm-only'],
    ['telegram operational', telegramOperationalRouting],
    ['telegram summary', telegramSummaryRouting],
    ['session file', sessionPath],
  ]);

  process.stdout.write('\\nSystem prompt\\n');
  process.stdout.write(payload.prompt.system + '\\n\\n');
  process.stdout.write('Development prompt\\n');
  process.stdout.write(payload.prompt.development + '\\n');
}

main();
`;
}
