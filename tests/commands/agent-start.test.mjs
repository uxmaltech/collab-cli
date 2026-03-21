import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../helpers/cli.mjs';
import { makeTempWorkspace } from '../helpers/workspace.mjs';

function createBirthTestEnv() {
  const env = { ...process.env };
  delete env.GEMINI_API_KEY;
  delete env.GEMINI_MODEL;
  delete env.OPENAI_API_KEY;
  delete env.OPENAI_MODEL;
  delete env.XAI_API_KEY;
  delete env.XAI_MODEL;
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_MODEL;
  env.TELEGRAM_BOT_TOKEN = 'telegram-token';
  return env;
}

test('collab agent start --help shows description and usage', () => {
  const result = runCli(['agent', 'start', '--help'], { env: createBirthTestEnv() });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /activate.*execute a born agent/i);
  assert.match(result.stdout, /collab agent start/);
});

test('agent start activates an explicit agent id from the born agent registry', () => {
  const workspace = makeTempWorkspace();
  const birth = runCli(
    [
      '--cwd',
      workspace,
      'agent',
      'birth',
      '--agent-name',
      'IoT Developer Agent',
      '--operator-id',
      'operator.telegram.130149339',
      '--json',
    ],
    { cwd: workspace, env: createBirthTestEnv() },
  );
  assert.equal(birth.status, 0, birth.stderr);

  const start = runCli(
    [
      '--cwd',
      workspace,
      'agent',
      'start',
      'agent.iot-developer-agent',
      '--json',
    ],
    { cwd: workspace, env: createBirthTestEnv() },
  );

  assert.equal(start.status, 0, start.stderr);
  const payload = JSON.parse(start.stdout);
  assert.equal(payload.agent.id, 'agent.iot-developer-agent');
  assert.equal(payload.agent.slug, 'iot-developer-agent');
  assert.equal(payload.agent.rootDir, workspace);
  assert.equal(payload.agent.entryFile, path.join(workspace, 'index.js'));
  assert.equal(payload.agent.configFile, path.join(workspace, '.collab', 'config.json'));
  assert.equal(
    payload.agent.birthFile,
    path.join(workspace, 'fixtures', 'iot-developer-agent', 'agent-birth.json'),
  );
  assert.deepEqual(payload.runtime.command, [
    'node',
    path.join(workspace, 'index.js'),
    'development',
  ]);
  assert.equal(payload.runtime.cwd, workspace);

  const registryPath = path.join(workspace, '.collab', 'agents.json');
  const activePath = path.join(workspace, '.collab', 'active-agent.json');
  assert.equal(fs.existsSync(registryPath), true);
  assert.equal(fs.existsSync(activePath), true);

  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const active = JSON.parse(fs.readFileSync(activePath, 'utf8'));
  assert.equal(registry.version, 1);
  assert.equal(registry.agents.length, 1);
  assert.equal(registry.agents[0].id, 'agent.iot-developer-agent');
  assert.equal(registry.agents[0].entryFile, 'index.js');
  assert.deepEqual(registry.agents[0].defaultArgs, ['development']);
  assert.equal(active.activeAgentId, 'agent.iot-developer-agent');
});

test('agent start resolves the agent from the control workspace and runs inside the agent root', () => {
  const workspace = makeTempWorkspace();
  const outputDir = path.join(workspace, 'iot-development-agent');
  const birth = runCli(
    [
      '--cwd',
      workspace,
      'agent',
      'birth',
      '--output',
      outputDir,
      '--agent-name',
      'IoT Developer Agent',
      '--operator-id',
      'operator.telegram.130149339',
      '--json',
    ],
    { cwd: workspace, env: createBirthTestEnv() },
  );
  assert.equal(birth.status, 0, birth.stderr);

  const start = runCli(
    [
      '--cwd',
      workspace,
      'agent',
      'start',
      'agent.iot-developer-agent',
      '--json',
    ],
    { cwd: workspace, env: createBirthTestEnv() },
  );

  assert.equal(start.status, 0, start.stderr);
  const payload = JSON.parse(start.stdout);
  assert.equal(payload.workspaceDir, workspace);
  assert.equal(payload.agent.rootDir, outputDir);
  assert.equal(payload.agent.entryFile, path.join(outputDir, 'index.js'));
  assert.equal(payload.agent.configFile, path.join(outputDir, '.collab', 'config.json'));
  assert.equal(
    payload.agent.birthFile,
    path.join(outputDir, 'fixtures', 'iot-developer-agent', 'agent-birth.json'),
  );
  assert.equal(payload.runtime.cwd, outputDir);
  assert.deepEqual(payload.runtime.command, [
    'node',
    path.join(outputDir, 'index.js'),
    'development',
  ]);

  const active = JSON.parse(
    fs.readFileSync(path.join(workspace, '.collab', 'active-agent.json'), 'utf8'),
  );
  assert.equal(active.activeAgentId, 'agent.iot-developer-agent');
  assert.equal(active.agent.rootDir, 'iot-development-agent');
});

test('agent start without an explicit id resolves the single born agent in the current workspace', () => {
  const workspace = makeTempWorkspace();
  const birth = runCli(
    [
      '--cwd',
      workspace,
      'agent',
      'birth',
      '--agent-name',
      'QA Agent',
      '--operator-id',
      'operator.telegram.130149339',
    ],
    { cwd: workspace, env: createBirthTestEnv() },
  );
  assert.equal(birth.status, 0, birth.stderr);

  const start = runCli(
    ['--cwd', workspace, 'agent', 'start', '--json'],
    { cwd: workspace, env: createBirthTestEnv() },
  );

  assert.equal(start.status, 0, start.stderr);
  const payload = JSON.parse(start.stdout);
  assert.equal(payload.agent.id, 'agent.qa-agent');
});

test('agent start can discover a born agent in a child directory when the control registry does not exist yet', () => {
  const workspace = makeTempWorkspace();
  const agentRoot = path.join(workspace, 'qa-agent');
  fs.mkdirSync(path.join(agentRoot, '.collab'), { recursive: true });
  fs.writeFileSync(
    path.join(agentRoot, '.collab', 'config.json'),
    JSON.stringify(
      {
        agent: {
          id: 'agent.qa-agent',
          name: 'QA Agent',
          slug: 'qa-agent',
          scope: 'qa.scope',
          selfRepository: 'anystream/qa-agent',
          assignedRepositories: ['anystream/api'],
          defaultProvider: 'codex',
          defaultProviderAuthMethod: 'cli',
          entrypoint: {
            file: 'index.js',
            defaultArgs: ['development'],
          },
          birth: {
            birthFile: 'fixtures/qa-agent/agent-birth.json',
          },
        },
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  const start = runCli(
    ['--cwd', workspace, 'agent', 'start', '--json'],
    { cwd: workspace, env: createBirthTestEnv() },
  );

  assert.equal(start.status, 0, start.stderr);
  const payload = JSON.parse(start.stdout);
  assert.equal(payload.agent.id, 'agent.qa-agent');
  assert.equal(payload.agent.rootDir, agentRoot);
  assert.equal(payload.runtime.cwd, agentRoot);
});

test('agent start without an explicit id fails clearly when multiple born agents exist in the workspace', () => {
  const workspace = makeTempWorkspace();
  fs.mkdirSync(path.join(workspace, '.collab'), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, '.collab', 'agents.json'),
    JSON.stringify(
      {
        version: 1,
        agents: [
          {
            id: 'agent.alpha',
            name: 'Alpha Agent',
            slug: 'alpha-agent',
            scope: 'alpha.scope',
            rootDir: '.',
            configFile: '.collab/config.json',
            birthFile: 'fixtures/alpha-agent/agent-birth.json',
            selfRepository: 'org/alpha-agent',
            assignedRepositories: ['org/alpha'],
            provider: 'gemini',
            providerAuthMethod: 'api-key',
            model: 'gemini-2.5-pro',
          },
          {
            id: 'agent.beta',
            name: 'Beta Agent',
            slug: 'beta-agent',
            scope: 'beta.scope',
            rootDir: '.',
            configFile: '.collab/config.json',
            birthFile: 'fixtures/beta-agent/agent-birth.json',
            selfRepository: 'org/beta-agent',
            assignedRepositories: ['org/beta'],
            provider: 'codex',
            providerAuthMethod: 'cli',
          },
        ],
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  const start = runCli(
    ['--cwd', workspace, 'agent', 'start'],
    { cwd: workspace, env: createBirthTestEnv() },
  );

  assert.notEqual(start.status, 0);
  assert.match(start.stderr, /multiple born agents/i);
  assert.match(start.stderr, /agent\.alpha/);
  assert.match(start.stderr, /agent\.beta/);
});
