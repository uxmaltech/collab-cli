import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createBufferedLogger } from '../helpers/test-context.mjs';

const {
  collectAgentBirthInteractiveInput,
  shouldRunBirthWizard,
} = await import('../../dist/lib/agent-bootstrap/wizard.js');
const {
  buildBirthWizardDraftPath,
  saveBirthWizardDraft,
} = await import('../../dist/lib/agent-bootstrap/draft-state.js');

function telegramResponse(result) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      ok: true,
      result,
    }),
  };
}

function defaultWizardTextAnswer(question) {
  if (question === 'TELEGRAM_WEBHOOK_PUBLIC_BASE_URL') {
    return '';
  }

  if (question === 'TELEGRAM_WEBHOOK_SECRET (optional)') {
    return '';
  }

  return undefined;
}

test('shouldRunBirthWizard defaults to wizard mode for tty sessions without explicit inputs', () => {
  assert.equal(
    shouldRunBirthWizard(
      { cwd: '/tmp/example' },
      { isInteractiveSession: true },
    ),
    true,
  );
});

test('shouldRunBirthWizard disables wizard for json or explicit inputs', () => {
  assert.equal(
    shouldRunBirthWizard(
      { cwd: '/tmp/example', json: true },
      { isInteractiveSession: true },
    ),
    false,
  );

  assert.equal(
    shouldRunBirthWizard(
      { cwd: '/tmp/example', agentName: 'IoT Agent' },
      { isInteractiveSession: true },
    ),
    false,
  );
});

test('shouldRunBirthWizard re-enters wizard for interactive force overwrite and rebirth', () => {
  assert.equal(
    shouldRunBirthWizard(
      { cwd: '/tmp/example', agentName: 'IoT Agent', forceMode: 'overwrite' },
      { isInteractiveSession: true },
    ),
    true,
  );

  assert.equal(
    shouldRunBirthWizard(
      { cwd: '/tmp/example', agentName: 'IoT Agent', forceMode: 'rebirth' },
      { isInteractiveSession: true },
    ),
    true,
  );
});

test('collectAgentBirthInteractiveInput maps wizard answers into canonical bootstrap input', async (t) => {
  const logs = [];
  const logger = createBufferedLogger(logs);
  const promptedTexts = [];
  const answers = new Map([
    ['Agent name', 'AnyStream IoT Development Agent'],
    ['Agent slug', 'iot-development-agent'],
    ['Agent id', 'agent.iot-development-agent'],
    ['Primary scope', 'anystream.iot'],
    ['Primary operator id', 'operator.telegram.130149339'],
    ['Additional operators (comma-separated, optional)', 'operator.github.enrique'],
    ['TELEGRAM_BOT_TOKEN', 'telegram-token'],
    ['Will this agent publish work summaries to a Telegram topic?', 'yes'],
    ['Accept commands from the team thread?', 'yes'],
    ['Primary role', 'Senior IoT Development Agent'],
    ['What will this agent do?', 'Build and maintain IoT software delivery flows across the assigned repositories.'],
    ['Soul mission', 'Keep IoT delivery visible, durable, and recoverable through Collab contracts.'],
    ['Default model', 'gemini-2.5-pro'],
    ['Cognitive MCP URL', 'http://localhost:8787/mcp'],
    ['Redis URL', 'redis://localhost:6379'],
    ['Cognitive MCP API key (optional)', 'mcp-api-key'],
    ['Redis password', 'collab-dev-redis'],
    ['Approved namespaces (comma-separated)', 'context.*,agent.*'],
    ['Egress URLs (comma-separated, or * for all)', '*'],
    ['Output directory', '/tmp/iot-agent'],
  ]);

  t.mock.method(globalThis, 'fetch', async (url) => {
    const href = String(url);

    if (href.includes('/getMe')) {
      return telegramResponse({
        id: 1,
        username: 'collab_iot_bot',
        first_name: 'Collab IoT',
      });
    }

    if (href.includes('/getUpdates')) {
      return telegramResponse([
        {
          update_id: 101,
          message: {
            message_id: 2,
            message_thread_id: 12,
            text: '/collab-bind AAAA',
            chat: {
              id: -1001234567890,
              type: 'supergroup',
              title: 'AnyStream Ops',
            },
          },
        },
      ]);
    }

    throw new Error(`unexpected fetch url: ${href}`);
  });

  const input = await collectAgentBirthInteractiveInput(
    {
      cwd: '/tmp',
    },
    {
      logger,
      collabDir: '/tmp/.collab',
      isInteractiveSession: true,
      repositoryPicker: {
        async pickRepositories() {
          return {
            selfRepository: 'anystream/iot-development-agent',
            assignedRepositories: ['anystream/iot-platform', 'anystream/iot-firmware'],
          };
        },
      },
      providerCliResolver() {
        return {
          command: 'gemini',
          available: true,
          configuredModel: 'gemini-2.5-pro',
        };
      },
      prompt: {
        async text(question) {
          promptedTexts.push(question);
          const defaultAnswer = defaultWizardTextAnswer(question);
          if (defaultAnswer !== undefined) {
            return defaultAnswer;
          }
          const answer = answers.get(question);
          assert.ok(answer !== undefined, `unexpected question: ${question}`);
          return answer;
        },
        async choice(question, choices, defaultValue) {
          if (question === 'Will this agent publish work summaries to a Telegram topic?') {
            assert.ok(choices.some((choice) => choice.value === 'yes'));
            assert.ok(choices.some((choice) => choice.value === 'no'));
            return 'yes';
          }
          if (question === 'Default provider') {
            assert.equal(defaultValue, 'gemini');
            assert.ok(choices.some((choice) => choice.value === 'gemini'));
            return 'gemini';
          }

          if (question === 'Authentication for Gemini (Google)') {
            assert.equal(defaultValue, 'api-key');
            assert.ok(choices.some((choice) => choice.value === 'cli'));
            assert.ok(choices.some((choice) => choice.value === 'api-key'));
            return 'api-key';
          }

          if (question === 'Accept commands from the team thread?') {
            assert.ok(choices.some((choice) => choice.value === 'yes'));
            assert.ok(choices.some((choice) => choice.value === 'no'));
            return 'yes';
          }

          throw new Error(`unexpected choice prompt: ${question}`);
        },
        async multiSelect() {
          return [];
        },
      },
    },
  );

  assert.equal(input.agentName, 'AnyStream IoT Development Agent');
  assert.equal(input.agentSlug, 'iot-development-agent');
  assert.equal(input.scope, 'anystream.iot');
  assert.equal(input.operatorId, 'operator.telegram.130149339,operator.github.enrique');
  assert.equal(input.selfRepository, 'anystream/iot-development-agent');
  assert.equal(input.assignedRepositories, 'anystream/iot-platform,anystream/iot-firmware');
  assert.equal(input.provider, 'gemini');
  assert.equal(input.providerAuthMethod, 'api-key');
  assert.equal(input.model, 'gemini-2.5-pro');
  assert.equal(input.cognitiveMcpUrl, 'http://localhost:8787/mcp');
  assert.equal(input.cognitiveMcpApiKey, 'mcp-api-key');
  assert.equal(input.telegramEnabled, true);
  assert.equal(input.telegramBotToken, 'telegram-token');
  assert.equal(input.telegramDefaultChatId, '-1001234567890');
  assert.equal(input.telegramThreadId, '12');
  assert.equal(promptedTexts.includes('Telegram default chat id'), false);
  assert.equal(promptedTexts.includes('Telegram thread id (optional)'), false);
  assert.equal(input.redisPassword, 'collab-dev-redis');
  assert.deepEqual(input.egressUrl, ['*']);
  assert.equal(input.output, '/tmp/iot-agent');
  assert.equal(input.birthProfile?.personaRole, 'Senior IoT Development Agent');
  assert.equal(
    input.birthProfile?.purpose,
    'Build and maintain IoT software delivery flows across the assigned repositories.',
  );
  assert.equal(
    input.birthProfile?.soulMission,
    'Keep IoT delivery visible, durable, and recoverable through Collab contracts.',
  );
  assert.ok(logs.some((line) => line.includes('collab agent birth')));
  assert.ok(logs.some((line) => line.includes('Telegram thread_id resolved automatically')));
  assert.ok(logs.some((line) => line.includes('Repositories')));
  assert.ok(logs.some((line) => line.includes('Mission')));
});

test('collectAgentBirthInteractiveInput falls back to /collab-bind when Telegram thread_id cannot be resolved automatically', async (t) => {
  const logs = [];
  const logger = createBufferedLogger(logs);
  const promptedTexts = [];
  let askedAboutSummaryThread = false;
  let telegramUpdatesCalls = 0;
  const answers = new Map([
    ['Agent name', 'Bindable Agent'],
    ['Agent slug', 'bindable-agent'],
    ['Agent id', 'agent.bindable-agent'],
    ['Primary scope', 'anystream.bindable'],
    ['Primary operator id', 'operator.telegram.130149339'],
    ['Additional operators (comma-separated, optional)', 'operator.github.enrique'],
    ['TELEGRAM_BOT_TOKEN', 'telegram-token'],
    ['Will this agent publish work summaries to a Telegram topic?', 'yes'],
    ['Accept commands from the team thread?', 'yes'],
    ['Primary role', 'Bindable Agent'],
    ['What will this agent do?', 'Resolve Telegram chat routing from birth.'],
    ['Soul mission', 'Keep the binding path explicit and recoverable.'],
    ['Default model', 'gemini-2.5-pro'],
    ['Cognitive MCP URL', 'http://localhost:8787/mcp'],
    ['Redis URL', 'redis://localhost:6379'],
    ['Cognitive MCP API key (optional)', ''],
    ['Redis password', 'collab-dev-redis'],
    ['Approved namespaces (comma-separated)', 'context.*,agent.*'],
    ['Egress URLs (comma-separated, or * for all)', '*'],
    ['Output directory', '/tmp/bindable-agent'],
  ]);

  t.mock.method(globalThis, 'fetch', async (url) => {
    const href = String(url);

    if (href.includes('/getMe')) {
      return telegramResponse({
        id: 1,
        username: 'collab_bind_bot',
      });
    }

    if (href.includes('/getUpdates')) {
      telegramUpdatesCalls += 1;
      if (telegramUpdatesCalls < 3) {
        return telegramResponse([]);
      }

      return telegramResponse([
        {
          update_id: 101,
          message: {
            message_id: 2,
            message_thread_id: 12,
            text: '/collab-bind AAAA',
            chat: {
              id: -1001234567890,
              type: 'supergroup',
              title: 'Bindable Ops',
            },
          },
        },
      ]);
    }

    throw new Error(`unexpected fetch url: ${href}`);
  });
  t.mock.method(Math, 'random', () => 0);

  const input = await collectAgentBirthInteractiveInput(
    {
      cwd: '/tmp',
    },
    {
      logger,
      collabDir: '/tmp/.collab',
      isInteractiveSession: true,
      repositoryPicker: {
        async pickRepositories() {
          return {
            selfRepository: 'bindable/self',
            assignedRepositories: ['bindable/repo-a'],
          };
        },
      },
      providerCliResolver() {
        return {
          command: 'gemini',
          available: true,
          configuredModel: 'gemini-2.5-pro',
        };
      },
      prompt: {
        async text(question) {
          promptedTexts.push(question);
          const defaultAnswer = defaultWizardTextAnswer(question);
          if (defaultAnswer !== undefined) {
            return defaultAnswer;
          }
          const answer = answers.get(question);
          assert.ok(answer !== undefined, `unexpected question: ${question}`);
          return answer;
        },
        async choice(question, choices, defaultValue) {
          if (question === 'Default provider') {
            assert.equal(defaultValue, 'gemini');
            assert.ok(choices.some((choice) => choice.value === 'gemini'));
            return 'gemini';
          }

          if (question === 'Authentication for Gemini (Google)') {
            assert.equal(defaultValue, 'api-key');
            assert.ok(choices.some((choice) => choice.value === 'api-key'));
            return 'api-key';
          }

          if (question === 'Will this agent publish work summaries to a Telegram topic?') {
            askedAboutSummaryThread = true;
            assert.ok(choices.some((choice) => choice.value === 'yes'));
            assert.ok(choices.some((choice) => choice.value === 'no'));
            return 'yes';
          }

          if (question === 'Accept commands from the team thread?') {
            return 'yes';
          }

          throw new Error(`unexpected choice prompt: ${question}`);
        },
        async multiSelect() {
          return [];
        },
      },
    },
  );

  assert.equal(input.telegramEnabled, true);
  assert.equal(input.telegramBotToken, 'telegram-token');
  assert.equal(input.telegramDefaultChatId, '-1001234567890');
  assert.equal(input.telegramThreadId, '12');
  assert.equal(promptedTexts.includes('Telegram default chat id'), false);
  assert.equal(promptedTexts.includes('Telegram thread id (optional)'), false);
  assert.equal(askedAboutSummaryThread, true);
  assert.ok(logs.some((line) => line.includes('/collab-bind')));
});

test('collectAgentBirthInteractiveInput skips model prompt for CLI-auth providers', async () => {
  const logger = createBufferedLogger([]);
  const answers = new Map([
    ['Agent name', 'Codex Agent'],
    ['Agent slug', 'codex-agent'],
    ['Agent id', 'agent.codex-agent'],
    ['Primary scope', 'anystream.codex'],
    ['Primary operator id', 'operator.telegram.130149339'],
    ['Additional operators (comma-separated, optional)', 'operator.github.codex-owner'],
    ['TELEGRAM_BOT_TOKEN', 'telegram-token'],
    ['Accept commands from the team thread?', 'no'],
    ['Primary role', 'Principal Repository Coding Agent'],
    ['What will this agent do?', 'Ship code changes for the repositories assigned to it.'],
    ['Soul mission', 'Turn GitHub work into visible contract-backed delivery.'],
    ['Cognitive MCP URL', 'http://localhost:8787/mcp'],
    ['Redis URL', 'redis://localhost:6379'],
    ['Cognitive MCP API key (optional)', ''],
    ['Redis password', 'collab-dev-redis'],
    ['Approved namespaces (comma-separated)', 'context.*,agent.*'],
    ['Egress URLs (comma-separated, or * for all)', '*'],
    ['Output directory', '/tmp/codex-agent'],
  ]);

  const promptedTexts = [];
  const input = await collectAgentBirthInteractiveInput(
    {
      cwd: '/tmp',
      telegramEnabled: true,
      telegramBotToken: 'telegram-token',
      telegramDefaultChatId: '-1001234567890',
      telegramThreadId: '12',
      telegramAllowTopicCommands: true,
    },
    {
      logger,
      collabDir: '/tmp/.collab',
      isInteractiveSession: true,
      repositoryPicker: {
        async pickRepositories() {
          return {
            selfRepository: 'anystream/codex-agent',
            assignedRepositories: ['anystream/app'],
          };
        },
      },
      providerCliResolver() {
        return {
          command: 'codex',
          available: true,
          configuredModel: 'gpt-5.3-codex',
        };
      },
      prompt: {
        async text(question) {
          promptedTexts.push(question);
          const defaultAnswer = defaultWizardTextAnswer(question);
          if (defaultAnswer !== undefined) {
            return defaultAnswer;
          }
          const answer = answers.get(question);
          assert.ok(answer !== undefined, `unexpected question: ${question}`);
          return answer;
        },
        async choice(question) {
          if (question === 'Accept commands from the team thread?') {
            return 'yes';
          }
          if (question === 'Default provider') {
            return 'codex';
          }
          if (question === 'Authentication for Codex (OpenAI)') {
            return 'cli';
          }
          throw new Error(`unexpected choice prompt: ${question}`);
        },
        async multiSelect() {
          return [];
        },
      },
    },
  );

  assert.equal(input.provider, 'codex');
  assert.equal(input.providerAuthMethod, 'cli');
  assert.equal(input.model, undefined);
  assert.equal(input.operatorId, 'operator.telegram.130149339,operator.github.codex-owner');
  assert.equal(input.telegramEnabled, true);
  assert.equal(input.telegramBotToken, 'telegram-token');
  assert.equal(promptedTexts.includes('Default model'), false);
});

test('collectAgentBirthInteractiveInput uses conversational birth mode when auto mode is enabled and a provider is available', async (t) => {
  const logs = [];
  const logger = createBufferedLogger(logs);
  const promptedTexts = [];
  let teamThreadChoiceAsked = false;
  let conversationTurns = 0;
  let repositoryPickerCalls = 0;

  t.mock.method(globalThis, 'fetch', async (url) => {
    const href = String(url);

    if (href.includes('/getMe')) {
      return telegramResponse({
        id: 1,
        username: 'collab_auto_bot',
      });
    }

    if (href.includes('/getUpdates')) {
      return telegramResponse([
        {
          update_id: 301,
          message: {
            message_id: 9,
            message_thread_id: 12,
            text: '/collab-bind AAAA',
            chat: {
              id: -1001234567890,
              type: 'supergroup',
              title: 'Auto Ops',
            },
          },
        },
      ]);
    }

    throw new Error(`unexpected fetch url: ${href}`);
  });

  const input = await collectAgentBirthInteractiveInput(
    { cwd: '/tmp' },
    {
      logger,
      collabDir: '/tmp/.collab',
      isInteractiveSession: true,
      wizardMode: 'auto',
      wizardPrevalidationResolver() {
        return {
          mode: 'conversational',
          selectedProvider: {
            provider: 'gemini',
            apiKeyEnvVar: 'GEMINI_API_KEY',
            apiKey: 'gemini-key',
            modelEnvVar: 'GEMINI_MODEL',
            model: 'gemini-2.5-pro',
            label: 'Gemini',
          },
          reason: 'Using Gemini from GEMINI_API_KEY for the conversational birth interview.',
        };
      },
      conversationAssistant: {
        async planTurn(_preferredProvider, currentState, transcript) {
          conversationTurns += 1;
          assert.equal(currentState.agentName, 'AnyStream IoT Development Agent');
          assert.equal(currentState.scope, 'anystream.iot');
          assert.equal(currentState.operatorIds?.join(','), 'operator.telegram.130149339');
          assert.equal(currentState.telegramEnabled, true);
          assert.equal(currentState.telegramThreadId, '12');
          assert.equal(transcript.length, 1);
          return {
            status: 'complete',
            assistantMessage: 'I have enough to define the birth of this agent.',
            missing: [],
            capture: {
              operatorIds: ['operator.telegram.130149339', 'operator.github.enrique'],
              agentName: 'AnyStream IoT Development Agent',
              agentSlug: 'iot-development-agent',
              agentId: 'agent.iot-development-agent',
              scope: 'anystream.iot',
              selfRepository: 'anystream/iot-development-agent',
              assignedRepositories: ['anystream/iot-platform'],
              provider: 'codex',
            providerAuthMethod: 'cli',
            cognitiveMcpUrl: 'http://localhost:8787/mcp',
            redisUrl: 'redis://localhost:6379',
            telegramEnabled: false,
            approvedNamespaces: ['context.*', 'agent.*'],
              egressUrl: ['*'],
              birthProfile: {
                personaRole: 'Senior IoT Development Agent',
                purpose: 'Build and maintain IoT delivery flows.',
                soulMission: 'Keep IoT delivery visible and durable.',
              },
            },
          };
        },
      },
      repositoryPicker: {
        async pickRepositories() {
          repositoryPickerCalls += 1;
          throw new Error('repository picker should not run when the conversational interview already captured repos');
        },
      },
      providerCliResolver() {
        return {
          command: 'codex',
          available: true,
          configuredModel: 'gpt-5.4',
        };
      },
      // Telegram routing is exercised by dedicated tests; this case focuses on conversational capture.
      prompt: {
        async text(question) {
          promptedTexts.push(question);
          const defaultAnswer = defaultWizardTextAnswer(question);
          if (defaultAnswer !== undefined) {
            return defaultAnswer;
          }
          if (question === 'Output directory') {
            return '/tmp/iot-agent-chat';
          }
          if (question === 'Agent name') {
            return 'AnyStream IoT Development Agent';
          }
          if (question === 'Agent slug') {
            return 'iot-development-agent';
          }
          if (question === 'Agent id') {
            return 'agent.iot-development-agent';
          }
          if (question === 'Primary scope') {
            return 'anystream.iot';
          }
          if (question === 'Primary operator id') {
            return 'operator.telegram.130149339';
          }
          if (question === 'Additional operators (comma-separated, optional)') {
            return '';
          }
          if (question === 'TELEGRAM_BOT_TOKEN') {
            return 'telegram-token';
          }
          if (question === 'Cognitive MCP API key (optional)') {
            return '';
          }
          if (question === 'Redis password') {
            return 'collab-dev-redis';
          }
          throw new Error(`unexpected text prompt: ${question}`);
        },
        async choice(question) {
          if (question === 'Will this agent publish work summaries to a Telegram topic?') {
            return 'yes';
          }
          if (question === 'Accept commands from the team thread?') {
            teamThreadChoiceAsked = true;
            return 'yes';
          }
          throw new Error(`unexpected choice prompt: ${question}`);
        },
        async multiSelect() {
          return [];
        },
      },
    },
  );

  assert.equal(input.provider, 'codex');
  assert.equal(input.providerAuthMethod, 'cli');
  assert.equal(input.model, undefined);
  assert.equal(input.operatorId, 'operator.telegram.130149339');
  assert.equal(input.selfRepository, 'anystream/iot-development-agent');
  assert.equal(input.assignedRepositories, 'anystream/iot-platform');
  assert.equal(input.birthProfile?.personaRole, 'Senior IoT Development Agent');
  assert.equal(input.birthProfile?.purpose, 'Build and maintain IoT delivery flows.');
  assert.equal(input.birthProfile?.soulMission, 'Keep IoT delivery visible and durable.');
  assert.equal(input.telegramEnabled, true);
  assert.equal(input.telegramBotToken, 'telegram-token');
  assert.equal(conversationTurns, 1);
  assert.equal(repositoryPickerCalls, 0);
  assert.ok(logs.some((line) => line.includes('Gemini interview')));
  assert.equal(promptedTexts.includes('Agent name'), true);
  assert.equal(promptedTexts.includes('Default provider'), false);
  assert.deepEqual(promptedTexts, [
    'Output directory',
    'Agent name',
    'Agent slug',
    'Agent id',
    'Primary scope',
    'Primary operator id',
    'Additional operators (comma-separated, optional)',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_WEBHOOK_PUBLIC_BASE_URL',
    'TELEGRAM_WEBHOOK_SECRET (optional)',
    'Cognitive MCP API key (optional)',
    'Redis password',
  ]);
  assert.equal(teamThreadChoiceAsked, true);
});

test('collectAgentBirthInteractiveInput resumes saved answers and skips completed prompts', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-agent-birth-resume-'));
  const outputDir = path.join(workspace, 'iot-agent');
  const logs = [];
  const logger = createBufferedLogger(logs);
  const promptedTexts = [];
  let repositoryPickerCalls = 0;

  saveBirthWizardDraft(outputDir, {
    agentName: 'AnyStream IoT Development Agent',
    agentSlug: 'iot-development-agent',
    agentId: 'agent.iot-development-agent',
    scope: 'anystream.iot',
    operatorId: 'operator.telegram.130149339,operator.github.enrique',
    telegramEnabled: true,
    telegramBotToken: 'telegram-token',
    telegramDefaultChatId: '-1001234567890',
    telegramThreadId: '12',
    telegramAllowTopicCommands: true,
    selfRepository: 'anystream/iot-development-agent',
    assignedRepositories: 'anystream/iot-platform,anystream/iot-firmware',
    provider: 'gemini',
    providerAuthMethod: 'api-key',
    model: 'gemini-2.5-pro',
    cognitiveMcpUrl: 'http://localhost:8787/mcp',
    output: outputDir,
    birthProfile: {
      personaRole: 'Senior IoT Development Agent',
      purpose: 'Build and maintain IoT software delivery flows across the assigned repositories.',
      soulMission: 'Keep IoT delivery visible, durable, and recoverable through Collab contracts.',
    },
  });

  const answers = new Map([
    ['Redis URL', 'redis://localhost:6379'],
    ['Cognitive MCP API key (optional)', ''],
    ['Redis password', 'collab-dev-redis'],
    ['Approved namespaces (comma-separated)', 'context.*,agent.*'],
    ['Egress URLs (comma-separated, or * for all)', '*'],
  ]);

  const input = await collectAgentBirthInteractiveInput(
    {
      cwd: workspace,
      output: outputDir,
    },
    {
      logger,
      collabDir: path.join(workspace, '.collab'),
      isInteractiveSession: true,
      repositoryPicker: {
        async pickRepositories() {
          repositoryPickerCalls += 1;
          return {
            selfRepository: 'unexpected/self',
            assignedRepositories: ['unexpected/repo'],
          };
        },
      },
      providerCliResolver() {
        return {
          command: 'gemini',
          available: true,
          configuredModel: 'gemini-2.5-pro',
        };
      },
      prompt: {
        async text(question) {
          promptedTexts.push(question);
          const defaultAnswer = defaultWizardTextAnswer(question);
          if (defaultAnswer !== undefined) {
            return defaultAnswer;
          }
          const answer = answers.get(question);
          assert.ok(answer !== undefined, `unexpected question: ${question}`);
          return answer;
        },
        async choice() {
          throw new Error('choice prompts should not be used in resume test');
        },
        async multiSelect() {
          return [];
        },
      },
    },
  );

  assert.equal(repositoryPickerCalls, 0);
  assert.deepEqual(promptedTexts, [
    'TELEGRAM_WEBHOOK_PUBLIC_BASE_URL',
    'TELEGRAM_WEBHOOK_SECRET (optional)',
    'Redis URL',
    'Cognitive MCP API key (optional)',
    'Redis password',
    'Approved namespaces (comma-separated)',
    'Egress URLs (comma-separated, or * for all)',
  ]);
  assert.equal(input.agentName, 'AnyStream IoT Development Agent');
  assert.equal(input.selfRepository, 'anystream/iot-development-agent');
  assert.equal(input.assignedRepositories, 'anystream/iot-platform,anystream/iot-firmware');
  assert.equal(input.model, 'gemini-2.5-pro');
  assert.deepEqual(input.egressUrl, ['*']);
  assert.equal(input.birthProfile?.personaRole, 'Senior IoT Development Agent');
  assert.equal(
    input.birthProfile?.purpose,
    'Build and maintain IoT software delivery flows across the assigned repositories.',
  );
  assert.equal(
    input.birthProfile?.soulMission,
    'Keep IoT delivery visible, durable, and recoverable through Collab contracts.',
  );
  assert.ok(logs.some((line) => line.includes('Resuming saved birth answers')));
});

test('collectAgentBirthInteractiveInput re-prompts operators when the saved draft only has the placeholder operator id', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-agent-birth-operator-placeholder-'));
  const outputDir = path.join(workspace, 'iot-agent');
  const logs = [];
  const logger = createBufferedLogger(logs);
  const promptedTexts = [];

  saveBirthWizardDraft(outputDir, {
    agentName: 'IoT Development Agent',
    agentSlug: 'iot-development-agent',
    agentId: 'agent.iot-development-agent',
    scope: 'anystream.iot',
    operatorId: 'operator.iot-development-agent',
    telegramEnabled: true,
    telegramBotToken: 'telegram-token',
    telegramDefaultChatId: '-1001234567890',
    telegramThreadId: '12',
    telegramAllowTopicCommands: false,
    selfRepository: 'anystream/iot-development-agent',
    assignedRepositories: 'anystream/iot-platform',
    provider: 'codex',
    providerAuthMethod: 'cli',
    cognitiveMcpUrl: 'http://localhost:8787/mcp',
    redisUrl: 'redis://localhost:6379',
    output: outputDir,
    birthProfile: {
      personaRole: 'Senior IoT Development Agent',
      purpose: 'Build and maintain IoT software delivery flows across the assigned repositories.',
      soulMission: 'Keep IoT delivery visible, durable, and recoverable through Collab contracts.',
    },
  });

  const answers = new Map([
    ['Primary operator id', 'operator.telegram.130149339'],
    ['Additional operators (comma-separated, optional)', 'operator.github.enrique'],
    ['Cognitive MCP API key (optional)', ''],
    ['Redis password', 'collab-dev-redis'],
    ['Approved namespaces (comma-separated)', 'context.*,agent.*'],
    ['Egress URLs (comma-separated, or * for all)', '*'],
  ]);

  const input = await collectAgentBirthInteractiveInput(
    {
      cwd: workspace,
      output: outputDir,
    },
    {
      logger,
      collabDir: path.join(workspace, '.collab'),
      isInteractiveSession: true,
      providerCliResolver() {
        return {
          command: 'codex',
          available: true,
          configuredModel: 'gpt-5.4',
        };
      },
      repositoryPicker: {
        async pickRepositories() {
          throw new Error('repository picker should not run when saved repositories already exist');
        },
      },
      prompt: {
        async text(question) {
          promptedTexts.push(question);
          const defaultAnswer = defaultWizardTextAnswer(question);
          if (defaultAnswer !== undefined) {
            return defaultAnswer;
          }
          const answer = answers.get(question);
          assert.ok(answer !== undefined, `unexpected question: ${question}`);
          return answer;
        },
        async choice() {
          throw new Error('choice prompts should not be used in placeholder operator resume test');
        },
        async multiSelect() {
          return [];
        },
      },
    },
  );

  assert.deepEqual(promptedTexts, [
    'Primary operator id',
    'Additional operators (comma-separated, optional)',
    'TELEGRAM_WEBHOOK_PUBLIC_BASE_URL',
    'TELEGRAM_WEBHOOK_SECRET (optional)',
    'Cognitive MCP API key (optional)',
    'Redis password',
    'Approved namespaces (comma-separated)',
    'Egress URLs (comma-separated, or * for all)',
  ]);
  assert.equal(input.operatorId, 'operator.telegram.130149339,operator.github.enrique');
  assert.ok(logs.some((line) => line.includes('Resuming saved birth answers')));
});

test('collectAgentBirthInteractiveInput resumes a saved conversational interview transcript', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-agent-birth-transcript-'));
  const outputDir = path.join(workspace, 'iot-agent');
  const logs = [];
  const logger = createBufferedLogger(logs);
  const promptedTexts = [];
  let repositoryPickerCalls = 0;
  let conversationTurns = 0;

  saveBirthWizardDraft(outputDir, {
    output: outputDir,
    agentName: 'IoT Developer Agent',
    agentSlug: 'iot-development-agent',
    agentId: 'agent.iot-development-agent',
    scope: 'anystream.iot',
    operatorId: 'operator.telegram.130149339,operator.github.enrique',
    telegramEnabled: true,
    telegramBotToken: 'telegram-token',
    telegramDefaultChatId: '-1001234567890',
    telegramThreadId: '12',
    telegramAllowTopicCommands: true,
    provider: 'codex',
    providerAuthMethod: 'cli',
    assignedRepositories: 'anystream/iot-websocket-relay,anystream/balena-ws-player',
    birthProfile: {
      personaRole: 'Senior Engineer',
      purpose: 'Implement production-ready features across the assigned IoT repositories.',
      soulMission: 'Deliver stable and maintainable code from GitHub issues.',
    },
    interviewTranscript: [
      {
        role: 'assistant',
        content:
          'I will define the birth of this agent with you. I will ask only for the gaps that matter to start the agent correctly.',
      },
      {
        role: 'assistant',
        content: "Where will this agent's own code and configuration live? Please provide the self repository.",
      },
    ],
  });

  const input = await collectAgentBirthInteractiveInput(
    {
      cwd: workspace,
      output: outputDir,
    },
    {
      logger,
      collabDir: path.join(outputDir, '.collab'),
      isInteractiveSession: true,
      wizardMode: 'auto',
      wizardPrevalidationResolver() {
        return {
          mode: 'conversational',
          selectedProvider: {
            provider: 'gemini',
            apiKeyEnvVar: 'GEMINI_API_KEY',
            apiKey: 'gemini-key',
            modelEnvVar: 'GEMINI_MODEL',
            model: 'gemini-2.5-pro',
            label: 'Gemini',
          },
          reason: 'Using Gemini from GEMINI_API_KEY for the conversational birth interview.',
        };
      },
      conversationAssistant: {
        async planTurn(_preferredProvider, currentState, transcript) {
          conversationTurns += 1;
          assert.equal(transcript.at(-1)?.role, 'user');
          assert.equal(transcript.at(-1)?.content, 'https://github.com/anystream/iot-development-agent');
          return {
            status: 'complete',
            assistantMessage: 'I have enough to finish the birth package.',
            missing: [],
            capture: {
              operatorIds: ['operator.telegram.130149339', 'operator.github.enrique'],
              selfRepository: 'anystream/iot-development-agent',
              cognitiveMcpUrl: 'http://localhost:8787/mcp',
              redisUrl: 'redis://localhost:6379',
              telegramEnabled: false,
              approvedNamespaces: ['context.*', 'agent.*'],
              egressUrl: ['*'],
              birthProfile: {
                soulEthos: 'stability and reliability',
              },
            },
          };
        },
      },
      repositoryPicker: {
        async pickRepositories() {
          repositoryPickerCalls += 1;
          throw new Error('repository picker should not run when interview transcript already captured repository answers');
        },
      },
      providerCliResolver() {
        return {
          command: 'codex',
          available: true,
          configuredModel: 'gpt-5.4',
        };
      },
      prompt: {
        async text(question) {
          promptedTexts.push(question);
          const defaultAnswer = defaultWizardTextAnswer(question);
          if (defaultAnswer !== undefined) {
            return defaultAnswer;
          }
          if (question === 'Your answer') {
            return 'https://github.com/anystream/iot-development-agent';
          }
          if (question === 'Cognitive MCP API key (optional)') {
            return '';
          }
          if (question === 'Redis password') {
            return 'collab-dev-redis';
          }
          throw new Error(`unexpected text prompt: ${question}`);
        },
        async choice() {
          throw new Error('choice prompts should not be used in conversational resume test');
        },
        async multiSelect() {
          return [];
        },
      },
    },
  );

  assert.equal(conversationTurns, 1);
  assert.equal(repositoryPickerCalls, 0);
  assert.deepEqual(promptedTexts, [
    'TELEGRAM_WEBHOOK_PUBLIC_BASE_URL',
    'TELEGRAM_WEBHOOK_SECRET (optional)',
    'Your answer',
    'Cognitive MCP API key (optional)',
    'Redis password',
  ]);
  assert.equal(input.selfRepository, 'anystream/iot-development-agent');
  assert.equal(input.assignedRepositories, 'anystream/iot-websocket-relay,anystream/balena-ws-player');
  assert.equal(input.provider, 'codex');
  assert.equal(input.providerAuthMethod, 'cli');
  assert.equal(input.operatorId, 'operator.telegram.130149339,operator.github.enrique');
  assert.equal(input.cognitiveMcpUrl, 'http://localhost:8787/mcp');
  assert.equal(input.redisUrl, 'redis://localhost:6379');
  assert.deepEqual(input.egressUrl, ['*']);
  assert.ok(logs.some((line) => line.includes('Resuming saved birth answers')));
  assert.ok(logs.some((line) => line.includes("Where will this agent's own code and configuration live?")));
});

test('collectAgentBirthInteractiveInput resets stale conversational transcript entries for Telegram and operators', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-agent-birth-stale-transcript-'));
  const outputDir = path.join(workspace, 'iot-agent');
  const logs = [];
  const logger = createBufferedLogger(logs);
  let conversationTurns = 0;

  t.mock.method(globalThis, 'fetch', async (url) => {
    const href = String(url);

    if (href.includes('/getMe')) {
      return telegramResponse({
        id: 1,
        username: 'stale_transcript_bot',
      });
    }

    if (href.includes('/getUpdates')) {
      return telegramResponse([
        {
          update_id: 401,
          message: {
            message_id: 3,
            message_thread_id: 21,
            text: '/collab-bind AAAA',
            chat: {
              id: -1001234567890,
              type: 'supergroup',
              title: 'Stale Transcript Ops',
            },
          },
        },
      ]);
    }

    throw new Error(`unexpected fetch url: ${href}`);
  });

  saveBirthWizardDraft(outputDir, {
    output: outputDir,
    agentName: 'IoT Developer Agent',
    agentSlug: 'iot-development-agent',
    agentId: 'agent.iot-development-agent',
    scope: 'anystream.iot',
    operatorId: 'operator.telegram.130149339',
    telegramEnabled: true,
    telegramBotToken: 'telegram-token',
    interviewTranscript: [
      {
        role: 'assistant',
        content:
          'I will define the birth of this agent with you. I will ask only for the gaps that matter to start the agent correctly.',
      },
      {
        role: 'assistant',
        content:
          'What is the destination chat ID and thread ID for Telegram, and what are the stable operator IDs for this agent?',
      },
    ],
  });

  const input = await collectAgentBirthInteractiveInput(
    {
      cwd: workspace,
      output: outputDir,
    },
    {
      logger,
      collabDir: path.join(outputDir, '.collab'),
      isInteractiveSession: true,
      wizardMode: 'auto',
      wizardPrevalidationResolver() {
        return {
          mode: 'conversational',
          selectedProvider: {
            provider: 'gemini',
            apiKeyEnvVar: 'GEMINI_API_KEY',
            apiKey: 'gemini-key',
            modelEnvVar: 'GEMINI_MODEL',
            model: 'gemini-2.5-pro',
            label: 'Gemini',
          },
          reason: 'Using Gemini from GEMINI_API_KEY for the conversational birth interview.',
        };
      },
      conversationAssistant: {
        async planTurn(_preferredProvider, _currentState, transcript) {
          conversationTurns += 1;
          assert.equal(transcript.length, 1);
          assert.ok(
            !transcript.some((message) => /chat id|thread id|operator ids/i.test(message.content)),
          );
          return {
            status: 'complete',
            assistantMessage: 'I have enough to finish the birth package.',
            missing: [],
            capture: {
              birthProfile: {
                personaRole: 'Senior Engineer',
                purpose: 'Implement production-ready features across the assigned IoT repositories.',
                soulMission: 'Deliver stable and maintainable code from GitHub issues.',
              },
            },
          };
        },
      },
      repositoryPicker: {
        async pickRepositories() {
          return {
            selfRepository: 'anystream/iot-development-agent',
            assignedRepositories: ['anystream/iot-websocket-relay'],
          };
        },
      },
      providerCliResolver() {
        return {
          command: 'codex',
          available: true,
          configuredModel: 'gpt-5.4',
        };
      },
      prompt: {
        async text(question) {
          const defaultAnswer = defaultWizardTextAnswer(question);
          if (defaultAnswer !== undefined) {
            return defaultAnswer;
          }
          if (question === 'Cognitive MCP API key (optional)') {
            return '';
          }
          if (question === 'Redis password') {
            return 'collab-dev-redis';
          }
          if (question === 'Runtime provider (codex, claude, gemini, copilot)') {
            return 'codex';
          }
          if (question === 'Authentication for Codex (OpenAI) (cli or api-key)') {
            return 'cli';
          }
          if (question === 'Cognitive MCP URL') {
            return 'http://localhost:8787/mcp';
          }
          if (question === 'Redis URL') {
            return 'redis://localhost:6379';
          }
          if (question === 'Approved namespaces (comma-separated)') {
            return 'context.*,agent.*';
          }
          if (question === 'Egress URLs (comma-separated, or * for all)') {
            return '*';
          }
          throw new Error(`unexpected text prompt: ${question}`);
        },
        async choice(question) {
          if (question === 'Will this agent publish work summaries to a Telegram topic?') {
            return 'yes';
          }
          if (question === 'Accept commands from the team thread?') {
            return 'yes';
          }
          if (question === 'Default provider') {
            return 'codex';
          }
          if (question === 'Authentication for Codex (OpenAI)') {
            return 'cli';
          }
          throw new Error(`unexpected choice prompt: ${question}`);
        },
        async multiSelect() {
          return [];
        },
      },
    },
  );

  assert.equal(conversationTurns, 1);
  assert.equal(input.telegramBotToken, 'telegram-token');
  assert.ok(
    logs.some((line) => line.includes('Resetting the saved conversational interview transcript')),
  );
});

test('collectAgentBirthInteractiveInput ignores saved answers when force mode is rebirth', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-agent-birth-force-'));
  const outputDir = path.join(workspace, 'iot-agent');
  const logs = [];
  const logger = createBufferedLogger(logs);
  let repositoryPickerCalls = 0;

  saveBirthWizardDraft(outputDir, {
    agentName: 'Old Agent',
    output: outputDir,
  });

  const answers = new Map([
    ['Agent name', 'Fresh Agent'],
    ['Agent slug', 'fresh-agent'],
    ['Agent id', 'agent.fresh-agent'],
    ['Primary scope', 'anystream.fresh'],
    ['Primary operator id', 'operator.telegram.130149339'],
    ['Additional operators (comma-separated, optional)', 'operator.github.release-manager'],
    ['Will this agent publish work summaries to a Telegram topic?', 'yes'],
    ['Primary role', 'Fresh Delivery Agent'],
    ['What will this agent do?', 'Own GitHub-driven delivery for the assigned product repositories.'],
    ['Soul mission', 'Keep delivery visible and contract-backed from birth.'],
    ['Default model', 'gemini-2.5-pro'],
    ['Cognitive MCP URL', 'http://localhost:8787/mcp'],
    ['Redis URL', 'redis://localhost:6379'],
    ['TELEGRAM_BOT_TOKEN', 'fresh-telegram-token'],
    ['Cognitive MCP API key (optional)', ''],
    ['Redis password', 'collab-dev-redis'],
    ['Approved namespaces (comma-separated)', 'context.*,agent.*'],
    ['Egress URLs (comma-separated, or * for all)', '*'],
    ['Accept commands from the team thread?', 'yes'],
  ]);

  t.mock.method(globalThis, 'fetch', async (url) => {
    const href = String(url);

    if (href.includes('/getMe')) {
      return telegramResponse({
        id: 2,
        username: 'fresh_delivery_bot',
      });
    }

    if (href.includes('/getUpdates')) {
      return telegramResponse([
        {
          update_id: 222,
          message: {
            message_id: 4,
            message_thread_id: 99,
            text: '/collab-bind AAAA',
            chat: {
              id: -1009876543210,
              type: 'supergroup',
              title: 'Fresh Delivery',
            },
          },
        },
      ]);
    }

    throw new Error(`unexpected fetch url: ${href}`);
  });
  t.mock.method(Math, 'random', () => 0);

  const input = await collectAgentBirthInteractiveInput(
    {
      cwd: workspace,
      output: outputDir,
      forceMode: 'rebirth',
    },
    {
      logger,
      collabDir: path.join(workspace, '.collab'),
      isInteractiveSession: true,
      repositoryPicker: {
        async pickRepositories() {
          repositoryPickerCalls += 1;
          return {
            selfRepository: 'anystream/fresh-agent',
            assignedRepositories: ['anystream/iot-platform'],
          };
        },
      },
      providerCliResolver() {
        return {
          command: 'gemini',
          available: true,
          configuredModel: 'gemini-2.5-pro',
        };
      },
      prompt: {
        async text(question) {
          const defaultAnswer = defaultWizardTextAnswer(question);
          if (defaultAnswer !== undefined) {
            return defaultAnswer;
          }
          const answer = answers.get(question);
          assert.ok(answer !== undefined, `unexpected question: ${question}`);
          return answer;
        },
        async choice(question) {
          if (question === 'Will this agent publish work summaries to a Telegram topic?') {
            return 'yes';
          }
          if (question === 'Default provider') {
            return 'gemini';
          }
          if (question === 'Authentication for Gemini (Google)') {
            return 'api-key';
          }
          if (question === 'Accept commands from the team thread?') {
            return 'yes';
          }
          throw new Error(`unexpected choice prompt: ${question}`);
        },
        async multiSelect() {
          return [];
        },
      },
    },
  );

  const draftPath = buildBirthWizardDraftPath(outputDir);
  const savedDraft = JSON.parse(fs.readFileSync(draftPath, 'utf8'));

  assert.equal(repositoryPickerCalls, 1);
  assert.equal(input.agentName, 'Fresh Agent');
  assert.equal(input.operatorId, 'operator.telegram.130149339,operator.github.release-manager');
  assert.equal(input.telegramEnabled, true);
  assert.equal(input.telegramBotToken, 'fresh-telegram-token');
  assert.equal(savedDraft.answers.agentName, 'Fresh Agent');
  assert.equal(savedDraft.answers.birthProfile.personaRole, 'Fresh Delivery Agent');
  assert.ok(logs.some((line) => line.includes('restarting the birth wizard from scratch')));
});

test('collectAgentBirthInteractiveInput uses the output directory .collab state for GitHub repository selection', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-agent-birth-output-'));
  const outputDir = path.join(workspace, 'iot-agent');
  const logs = [];
  const logger = createBufferedLogger(logs);

  fs.mkdirSync(path.join(outputDir, '.collab'), { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, '.collab', 'github-auth.json'),
    JSON.stringify(
      {
        provider: 'github',
        token: 'test-token',
        scopes: ['repo'],
        created_at: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  t.mock.method(globalThis, 'fetch', async (url) => {
    const href = String(url);

    if (href === 'https://api.github.com/user') {
      return {
        ok: true,
        status: 200,
        text: async () => '',
      };
    }

    if (href.includes('api.github.com/search/repositories')) {
      const parsed = new URL(href);
      const query = parsed.searchParams.get('q');

      if (query === 'iot-agent') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            total_count: 1,
            items: [
              {
                full_name: 'anystream/iot-development-agent',
                description: 'Agent repo',
                private: true,
                default_branch: 'main',
              },
            ],
          }),
        };
      }

      if (query === 'anystream') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            total_count: 2,
            items: [
              {
                full_name: 'anystream/iot-development-agent',
                description: 'Agent repo',
                private: true,
                default_branch: 'main',
              },
              {
                full_name: 'anystream/iot-platform',
                description: 'Platform repo',
                private: true,
                default_branch: 'main',
              },
            ],
          }),
        };
      }
    }

    throw new Error(`Unexpected fetch: ${href}`);
  });

  const answers = new Map([
    ['Agent name', 'AnyStream IoT Development Agent'],
    ['Agent slug', 'iot-development-agent'],
    ['Agent id', 'agent.iot-development-agent'],
    ['Primary scope', 'anystream.iot'],
    ['Primary operator id', 'operator.telegram.130149339'],
    ['Additional operators (comma-separated, optional)', 'operator.github.enrique'],
    ['Search GitHub repositories for the agent self repository', 'iot-agent'],
    ['Search GitHub repositories for assigned work', 'anystream'],
    ['Primary role', 'Senior IoT Development Agent'],
    ['What will this agent do?', 'Build and maintain IoT software delivery flows across the assigned repositories.'],
    ['Soul mission', 'Keep IoT delivery visible, durable, and recoverable through Collab contracts.'],
    ['Default model', 'gemini-2.5-pro'],
    ['Cognitive MCP URL', 'http://localhost:8787/mcp'],
    ['Redis URL', 'redis://localhost:6379'],
    ['Cognitive MCP API key (optional)', ''],
    ['Redis password', 'collab-dev-redis'],
    ['Approved namespaces (comma-separated)', 'context.*,agent.*'],
    ['Egress URLs (comma-separated, or * for all)', '*'],
  ]);

  const input = await collectAgentBirthInteractiveInput(
    {
      cwd: workspace,
      output: outputDir,
      telegramEnabled: true,
      telegramBotToken: 'telegram-token',
      telegramDefaultChatId: '-1001234567890',
      telegramThreadId: '12',
      telegramAllowTopicCommands: true,
    },
    {
      logger,
      isInteractiveSession: true,
      providerCliResolver() {
        return {
          command: 'gemini',
          available: true,
          configuredModel: 'gemini-2.5-pro',
        };
      },
      prompt: {
        async text(question) {
          const defaultAnswer = defaultWizardTextAnswer(question);
          if (defaultAnswer !== undefined) {
            return defaultAnswer;
          }
          const answer = answers.get(question);
          assert.ok(answer !== undefined, `unexpected question: ${question}`);
          return answer;
        },
        async choice(question) {
          if (question === 'Select self repository') {
            return 'anystream/iot-development-agent';
          }
          if (question === 'Assign additional repositories from GitHub?') {
            return 'yes';
          }
          if (question === 'Add more assigned repositories?') {
            return 'no';
          }
          if (question === 'Default provider') {
            return 'gemini';
          }
          if (question === 'Authentication for Gemini (Google)') {
            return 'api-key';
          }
          throw new Error(`unexpected choice prompt: ${question}`);
        },
        async multiSelect(question) {
          assert.equal(question, 'Select assigned repositories');
          return ['anystream/iot-platform'];
        },
      },
    },
  );

  assert.equal(input.output, outputDir);
  assert.equal(input.operatorId, 'operator.telegram.130149339,operator.github.enrique');
  assert.equal(input.selfRepository, 'anystream/iot-development-agent');
  assert.equal(input.assignedRepositories, 'anystream/iot-platform');
});
