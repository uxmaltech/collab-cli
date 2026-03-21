import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  generateAgentBootstrap,
  summarizeAgentBootstrap,
} = require('../../dist/lib/agent-bootstrap/generate.js');

test('generateAgentBootstrap returns deterministic file paths and valid JSON outputs', () => {
  const workspace = '/tmp/collab-bootstrap-example';
  const result = generateAgentBootstrap({
    cwd: workspace,
    agentName: 'Collab Runtime Architect',
    operatorId: 'operator.telegram.130149339',
    telegramEnabled: true,
    telegramBotToken: 'telegram-token',
  });

  assert.equal(result.options.agentSlug, 'collab-runtime-architect');
  assert.equal(result.options.cognitiveMcpUrl, 'http://127.0.0.1:8787/mcp');
  assert.equal(result.options.selfRepository, 'local/collab-runtime-architect');
  assert.deepEqual(result.options.assignedRepositories, []);
  assert.equal(result.files.length, 14);
  assert.deepEqual(
    result.files.map((file) => file.relativePath),
    [
      '.collab/config.json',
      '.env.example',
      '.env',
      '.gitignore',
      'package.json',
      'Dockerfile',
      'index.js',
      path.join('fixtures', 'collab-runtime-architect', 'agent-birth.json'),
      path.join('fixtures', 'collab-runtime-architect', 'visible-prompts.json'),
      path.join('docs', 'collab-runtime-architect-birth.md'),
      path.join('skills', 'collab-runtime-architect-bootstrap', 'SKILL.md'),
      path.join('infra', 'docker-compose.yml'),
      path.join('infra', 'docker-compose.infra.yml'),
      path.join('infra', 'docker-compose.mcp.yml'),
    ],
  );

  const configFile = result.files.find((file) => file.relativePath === '.collab/config.json');
  const packageJsonFile = result.files.find((file) => file.relativePath === 'package.json');
  const entrypointFile = result.files.find((file) => file.relativePath === 'index.js');
  const birthFile = result.files.find((file) => file.relativePath.endsWith('agent-birth.json'));
  const promptsFile = result.files.find((file) => file.relativePath.endsWith('visible-prompts.json'));

  assert.ok(configFile);
  assert.ok(packageJsonFile);
  assert.ok(entrypointFile);
  assert.ok(birthFile);
  assert.ok(promptsFile);
  assert.doesNotThrow(() => JSON.parse(configFile.content));
  assert.doesNotThrow(() => JSON.parse(packageJsonFile.content));
  assert.doesNotThrow(() => JSON.parse(birthFile.content));
  assert.doesNotThrow(() => JSON.parse(promptsFile.content));
  assert.match(entrypointFile.content, /Collab agent runtime session/);
});

test('summarizeAgentBootstrap returns a stable machine-readable manifest', () => {
  const summary = summarizeAgentBootstrap(
    generateAgentBootstrap({
      cwd: '/tmp/collab-bootstrap-summary',
      agentName: 'Collab Runtime Architect',
      operatorId: 'operator.telegram.130149339',
      telegramEnabled: true,
      telegramBotToken: 'telegram-token',
    }),
  );

  assert.equal(summary.agent.slug, 'collab-runtime-architect');
  assert.equal(summary.agent.id, 'agent.collab-runtime-architect');
  assert.equal(summary.agent.cognitiveMcpUrl, 'http://127.0.0.1:8787/mcp');
  assert.equal(summary.agent.selfRepository, 'local/collab-runtime-architect');
  assert.deepEqual(summary.agent.assignedRepositories, []);
  assert.equal(summary.files.length, 14);
  assert.deepEqual(summary.files[0], { path: '.collab/config.json' });
});

test('generateAgentBootstrap honors explicit role, purpose, and soul mission in the birth profile', () => {
  const result = generateAgentBootstrap({
    cwd: '/tmp/collab-bootstrap-persona',
    agentName: 'AnyStream IoT Agent',
    operatorId: 'operator.telegram.130149339',
    selfRepository: 'anystream/iot-development-agent',
    assignedRepositories: 'anystream/balena-ws-player',
    telegramEnabled: true,
    telegramBotToken: 'telegram-token',
    birthProfile: {
      personaRole: 'Senior IoT Software Engineer',
      purpose: 'Build and evolve IoT delivery systems backed by GitHub and Collab contracts.',
      soulMission: 'Keep IoT delivery explicit, durable, and operationally visible.',
    },
  });

  assert.equal(result.options.birthProfile.personaRole, 'Senior IoT Software Engineer');
  assert.equal(
    result.options.birthProfile.purpose,
    'Build and evolve IoT delivery systems backed by GitHub and Collab contracts.',
  );
  assert.equal(
    result.options.birthProfile.soulMission,
    'Keep IoT delivery explicit, durable, and operationally visible.',
  );
  assert.match(result.options.birthProfile.systemPrompt, /Senior IoT Software Engineer/);
  assert.match(
    result.options.birthProfile.systemPrompt,
    /Build and evolve IoT delivery systems backed by GitHub and Collab contracts\./,
  );
  assert.match(
    result.options.birthProfile.systemPrompt,
    /Keep IoT delivery explicit, durable, and operationally visible\./,
  );

  const birthFile = result.files.find((file) => file.relativePath.endsWith('agent-birth.json'));
  assert.ok(birthFile);
  const birthPayload = JSON.parse(birthFile.content);
  assert.equal(birthPayload.persona.role, 'Senior IoT Software Engineer');
  assert.equal(
    birthPayload.purpose,
    'Build and evolve IoT delivery systems backed by GitHub and Collab contracts.',
  );
  assert.equal(
    birthPayload.soul.mission,
    'Keep IoT delivery explicit, durable, and operationally visible.',
  );
});

test('generateAgentBootstrap allows Telegram operator DM fallback when operator id is operator.telegram.<user-id>', () => {
  const result = generateAgentBootstrap({
    cwd: '/tmp/collab-bootstrap-telegram-operator',
    agentName: 'Operator Routed Agent',
    operatorId: 'operator.telegram.130149339,operator.telegram.222222222,operator.github.enrique',
    telegramEnabled: true,
    telegramBotToken: 'telegram-token',
  });

  assert.equal(result.options.operatorId, 'operator.telegram.130149339');
  assert.deepEqual(result.options.operatorIds, [
    'operator.telegram.130149339',
    'operator.telegram.222222222',
    'operator.github.enrique',
  ]);
  assert.equal(result.options.telegramEnabled, true);
  assert.equal(result.options.telegramDefaultChatId, '');
  assert.equal(result.options.telegramThreadId, '');

  const configFile = result.files.find((file) => file.relativePath === '.collab/config.json');
  const envExampleFile = result.files.find((file) => file.relativePath === '.env.example');
  const entrypointFile = result.files.find((file) => file.relativePath === 'index.js');

  assert.ok(configFile);
  assert.ok(envExampleFile);
  assert.ok(entrypointFile);

  const configPayload = JSON.parse(configFile.content);
  assert.equal(configPayload.agent.notifications.telegram.operationalOutput.mode, 'originating-operator');
  assert.equal(configPayload.agent.notifications.telegram.operationalOutput.primaryOperatorProfileId, 'operator.telegram.130149339');
  assert.deepEqual(configPayload.agent.notifications.telegram.operationalOutput.operatorProfileIds, [
    'operator.telegram.130149339',
    'operator.telegram.222222222',
    'operator.github.enrique',
  ]);
  assert.deepEqual(configPayload.agent.notifications.telegram.operationalOutput.operatorTelegramUserIds, [
    '130149339',
    '222222222',
  ]);
  assert.equal(configPayload.agent.notifications.telegram.teamSummary.mode, 'disabled');
  assert.equal(configPayload.agent.notifications.telegram.commandIngress.allowDirectMessagesFromOperator, true);

  assert.deepEqual(configPayload.agent.profiles.operator.ids, [
    'operator.telegram.130149339',
    'operator.telegram.222222222',
    'operator.github.enrique',
  ]);
  assert.match(envExampleFile.content, /Operational output goes to the originating operator by DM/);
  assert.match(entrypointFile.content, /telegram operational/);
});
