import type { AgentBootstrapOptions } from '../../lib/agent-bootstrap/types';

export function agentEntrypointTemplate(options: AgentBootstrapOptions): string {
  const assignedRepositories = JSON.stringify(options.assignedRepositories);
  const operatorIds = JSON.stringify(options.operatorIds);

  return `#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const AGENT_NAME = ${JSON.stringify(options.agentName)};
const AGENT_ID = ${JSON.stringify(options.agentId)};
const AGENT_SCOPE = ${JSON.stringify(options.scope)};
const SELF_REPOSITORY = ${JSON.stringify(options.selfRepository)};
const ASSIGNED_REPOSITORIES = ${assignedRepositories};
const OPERATOR_IDS = ${operatorIds};

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

function buildInspectPayload(workspaceDir) {
  const configPath = path.join(workspaceDir, '.collab', 'config.json');
  const config = readJson(configPath);
  const mode = process.argv[2] || 'development';
  return {
    pid: process.pid,
    mode,
    workspaceDir,
    agent: {
      id: AGENT_ID,
      name: AGENT_NAME,
      scope: AGENT_SCOPE,
      selfRepository: SELF_REPOSITORY,
      assignedRepositories: ASSIGNED_REPOSITORIES,
      provider: config.agent.defaultProvider,
      providerAuthMethod: config.agent.defaultProviderAuthMethod,
      model: config.agent.defaultModel || null,
      operators: OPERATOR_IDS,
    },
    runtime: {
      cognitiveMcpUrl: process.env.COGNITIVE_MCP_URL || config.agent.mcp.cognitive.serverUrl,
      redisUrl: process.env.REDIS_URL || config.agent.redisUrl,
      telegram: {
        botConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
        webhookPublicBaseUrl: process.env.TELEGRAM_WEBHOOK_PUBLIC_BASE_URL || '',
        webhookBindHost: process.env.TELEGRAM_WEBHOOK_BIND_HOST || '127.0.0.1',
        webhookPort: process.env.TELEGRAM_WEBHOOK_PORT || '8788',
        summaryChatId: process.env.TELEGRAM_DEFAULT_CHAT_ID || '',
        summaryThreadId: process.env.TELEGRAM_THREAD_ID || '',
        allowTopicCommands: Boolean(config.agent.notifications?.telegram?.commandIngress?.allowTopicCommands),
        operationalOutputMode: config.agent.notifications?.telegram?.operationalOutput?.mode || 'disabled',
        teamSummaryMode: config.agent.notifications?.telegram?.teamSummary?.mode || 'disabled',
      },
    },
  };
}

async function main() {
  const workspaceDir = process.cwd();
  readEnvFile(path.join(workspaceDir, '.env'));

  const [mode = 'development'] = process.argv.slice(2);
  if (mode === 'inspect') {
    process.stdout.write(JSON.stringify(buildInspectPayload(workspaceDir), null, 2) + '\\n');
    return;
  }

  let runtimePackage;
  try {
    runtimePackage = await import('collab-agent-runtime');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      'The born agent runtime dependency is not installed. Run "npm install" in this agent workspace before starting it. Root cause: ' + reason,
    );
  }

  if (typeof runtimePackage.runDevelopmentHost !== 'function') {
    throw new Error('collab-agent-runtime does not export runDevelopmentHost().');
  }

  await runtimePackage.runDevelopmentHost({
    workspaceDir,
    mode,
  });
}

main().catch((error) => {
  const reason = error instanceof Error ? error.message : String(error);
  process.stderr.write(reason + '\\n');
  process.exitCode = 1;
});
`;
}
