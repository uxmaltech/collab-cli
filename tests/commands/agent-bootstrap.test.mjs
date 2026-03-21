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

function nonInteractiveBirthArgs(agentName, extraArgs = []) {
  return [
    '--agent-name',
    agentName,
    '--operator-id',
    'operator.telegram.130149339',
    '--telegram-bot-token',
    'telegram-token',
    ...extraArgs,
  ];
}

test('collab agent bootstrap --help shows description and key options', () => {
  const result = runCli(['agent', 'bootstrap', '--help'], { env: createBirthTestEnv() });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /canonical Collab agent birth package/i);
  assert.match(result.stdout, /--agent-name/);
  assert.doesNotMatch(result.stdout, /--runtime-source/);
  assert.match(result.stdout, /--cognitive-mcp-url/);
  assert.doesNotMatch(result.stdout, /--congnitive-mcp-url/);
  assert.doesNotMatch(result.stdout, /--mcp-url/);
  assert.match(result.stdout, /--self-repository/);
  assert.match(result.stdout, /--assigned-repositories/);
  assert.match(result.stdout, /--provider-auth/);
  assert.match(result.stdout, /--telegram-bot-token/);
  assert.match(result.stdout, /--egress-url/);
  assert.doesNotMatch(result.stdout, /--egress-urls/);
  assert.match(result.stdout, /--force <mode>/);
  assert.match(result.stdout, /--interactive/);
  assert.match(result.stdout, /--no-interactive/);
});

test('collab agent birth alias shows the bootstrap help', () => {
  const result = runCli(['agent', 'birth', '--help'], { env: createBirthTestEnv() });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /canonical Collab agent birth package/i);
  assert.match(result.stdout, /--agent-name/);
});

test('collab --help lists the agent command', () => {
  const result = runCli(['--help'], { env: createBirthTestEnv() });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\bagent\b/);
});

test('bootstrap and birth alias produce identical JSON summaries in dry-run mode', () => {
  const workspace = makeTempWorkspace();
  const bootstrap = runCli(
    [
      '--cwd',
      workspace,
      '--dry-run',
      'agent',
      'bootstrap',
      '--agent-name',
      'Collab Architect',
      '--operator-id',
      'operator.telegram.130149339',
      '--telegram-bot-token',
      'telegram-token',
      '--json',
    ],
    { cwd: workspace, env: createBirthTestEnv() },
  );
  const birth = runCli(
    [
      '--cwd',
      workspace,
      '--dry-run',
      'agent',
      'birth',
      '--agent-name',
      'Collab Architect',
      '--operator-id',
      'operator.telegram.130149339',
      '--telegram-bot-token',
      'telegram-token',
      '--json',
    ],
    { cwd: workspace, env: createBirthTestEnv() },
  );

  assert.equal(bootstrap.status, 0, bootstrap.stderr);
  assert.equal(birth.status, 0, birth.stderr);
  assert.equal(bootstrap.stdout, birth.stdout);
});

test('bootstrap writes the canonical birth package files', () => {
  const workspace = makeTempWorkspace();
  const result = runCli(
    [
      '--cwd',
      workspace,
      'agent',
      'bootstrap',
      '--agent-name',
      'Collab Architect',
      '--operator-id',
      'operator.telegram.130149339',
      '--telegram-bot-token',
      'telegram-token',
      '--json',
    ],
    { cwd: workspace, env: createBirthTestEnv() },
  );

  assert.equal(result.status, 0, result.stderr);

  const summary = JSON.parse(result.stdout);
  assert.equal(summary.agent.slug, 'collab-architect');
  assert.equal(summary.agent.cognitiveMcpUrl, 'http://127.0.0.1:8787/mcp');
  assert.equal(summary.agent.selfRepository, 'local/collab-architect');
  assert.deepEqual(summary.agent.assignedRepositories, []);
  assert.equal(summary.files.length, 15);

  const configPath = path.join(workspace, '.collab', 'config.json');
  const envExamplePath = path.join(workspace, '.env.example');
  const envPath = path.join(workspace, '.env');
  const gitignorePath = path.join(workspace, '.gitignore');
  const packageJsonPath = path.join(workspace, 'package.json');
  const dockerfilePath = path.join(workspace, 'Dockerfile');
  const entrypointPath = path.join(workspace, 'index.js');
  const birthPath = path.join(workspace, 'fixtures', 'collab-architect', 'agent-birth.json');
  const promptsPath = path.join(workspace, 'fixtures', 'collab-architect', 'visible-prompts.json');
  const docPath = path.join(workspace, 'docs', 'collab-architect-birth.md');
  const skillPath = path.join(workspace, 'skills', 'collab-architect-bootstrap', 'SKILL.md');
  const skillManifestPath = path.join(workspace, 'skills', 'collab-architect-bootstrap', 'skill.json');
  const composePath = path.join(workspace, 'infra', 'docker-compose.yml');
  const infraComposePath = path.join(workspace, 'infra', 'docker-compose.infra.yml');
  const mcpComposePath = path.join(workspace, 'infra', 'docker-compose.mcp.yml');

  for (const filePath of [
    configPath,
    envExamplePath,
    envPath,
    gitignorePath,
    packageJsonPath,
    dockerfilePath,
    entrypointPath,
    birthPath,
    promptsPath,
    docPath,
    skillPath,
    skillManifestPath,
    composePath,
    infraComposePath,
    mcpComposePath,
  ]) {
    assert.equal(fs.existsSync(filePath), true, `${filePath} should exist`);
  }

  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(configPath, 'utf8')));
  const configPayload = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const birthPayload = JSON.parse(fs.readFileSync(birthPath, 'utf8'));
  const skillManifestPayload = JSON.parse(fs.readFileSync(skillManifestPath, 'utf8'));
  const packagePayload = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const envExample = fs.readFileSync(envExamplePath, 'utf8');
  const envFile = fs.readFileSync(envPath, 'utf8');
  assert.equal(configPayload.agent.mcp.cognitive.serverUrl, 'http://127.0.0.1:8787/mcp');
  assert.equal(configPayload.agent.mcp.cognitive.apiKeyEnvVar, 'COGNITIVE_MCP_API_KEY');
  assert.equal(configPayload.agent.notifications.telegram.botTokenEnvVar, 'TELEGRAM_BOT_TOKEN');
  assert.equal(configPayload.agent.notifications.telegram.defaultChatIdEnvVar, 'TELEGRAM_DEFAULT_CHAT_ID');
  assert.equal(configPayload.agent.notifications.telegram.operationalOutput.mode, 'originating-operator');
  assert.equal(configPayload.agent.notifications.telegram.teamSummary.mode, 'disabled');
  assert.deepEqual(configPayload.agent.profiles.operator.ids, ['operator.telegram.130149339']);
  assert.equal(configPayload.agent.infrastructure.services.redis.passwordEnvVar, 'REDIS_PASSWORD');
  assert.equal(configPayload.agent.entrypoint.file, 'index.js');
  assert.deepEqual(configPayload.agent.entrypoint.defaultArgs, ['development']);
  assert.equal(configPayload.agent.persistence.durableStateBackend, 'cognitive-mcp');
  assert.deepEqual(configPayload.agent.persistence.durableNamespaces, [
    'agent.identity.*',
    'agent.project.*',
    'agent.task.*',
    'agent.session.*',
    'agent.memory.*',
  ]);
  assert.equal(configPayload.agent.selfRepository, 'local/collab-architect');
  assert.deepEqual(configPayload.agent.assignedRepositories, []);
  assert.equal(configPayload.assistants.providers.gemini.auth.envVar, 'GEMINI_API_KEY');
  assert.equal(birthPayload.operating_boundaries.self_repository, 'local/collab-architect');
  assert.deepEqual(birthPayload.operating_boundaries.assigned_repositories, []);
  assert.equal(skillManifestPayload.skill_id, 'collab-architect.bootstrap');
  assert.equal(skillManifestPayload.instructions_path, 'SKILL.md');
  assert.equal(
    birthPayload.operating_boundaries.cognitive_mcp_endpoint,
    'http://127.0.0.1:8787/mcp',
  );
  assert.match(
    birthPayload.operating_boundaries.durable_state_policy,
    /persist identity, project, task, session, and memory state in the cognitive infrastructure/i,
  );
  assert.match(envExample, /^GEMINI_API_KEY=/m);
  assert.match(envExample, /^OPENAI_API_KEY=/m);
  assert.match(envExample, /^XAI_API_KEY=/m);
  assert.match(envExample, /^ANTHROPIC_API_KEY=/m);
  assert.match(envExample, /^TELEGRAM_BOT_TOKEN=/m);
  assert.match(envExample, /^TELEGRAM_DEFAULT_CHAT_ID=/m);
  assert.match(envExample, /^REDIS_PASSWORD=/m);
  assert.match(envExample, /^COGNITIVE_MCP_API_KEY=/m);
  assert.match(envFile, /^TELEGRAM_BOT_TOKEN=/m);
  assert.match(envFile, /^REDIS_PASSWORD=collab-dev-redis$/m);
  assert.match(envFile, /^COGNITIVE_MCP_API_KEY=$/m);
  assert.doesNotMatch(envExample, /^QDRANT_URL=/m);
  assert.doesNotMatch(envExample, /^NEBULA_PASSWORD=/m);
  assert.doesNotMatch(envExample, /^MINIO_SECRET_KEY=/m);
  assert.equal(packagePayload.name, 'collab-architect');
  assert.equal(packagePayload.scripts.start, 'node index.js development');
  assert.equal(
    packagePayload.dependencies['collab-agent-runtime'],
    'git+https://github.com/uxmaltech/collab-agent-runtime.git#codex/fase-0-start-agent-runtime',
  );
  assert.match(fs.readFileSync(dockerfilePath, 'utf8'), /FROM node:22-alpine/);
  assert.match(fs.readFileSync(entrypointPath, 'utf8'), /runDevelopmentHost/);
  assert.match(fs.readFileSync(entrypointPath, 'utf8'), /collab-agent-runtime/);
  assert.match(fs.readFileSync(entrypointPath, 'utf8'), /TELEGRAM_WEBHOOK_PUBLIC_BASE_URL/);
  assert.match(fs.readFileSync(composePath, 'utf8'), /services:\n  agent:/);
  assert.match(fs.readFileSync(infraComposePath, 'utf8'), /qdrant:/);
  assert.match(fs.readFileSync(mcpComposePath, 'utf8'), /cognitive-mcp:/);
  assert.match(fs.readFileSync(mcpComposePath, 'utf8'), /QDRANT_URL: http:\/\/qdrant:6333/);
  assert.match(fs.readFileSync(gitignorePath, 'utf8'), /^\.env$/m);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(promptsPath, 'utf8')));
  assert.match(fs.readFileSync(docPath, 'utf8'), /Collab Architect Birth Guide/);
  assert.match(fs.readFileSync(skillPath, 'utf8'), /Bootstrap Skill/);
});

test('bootstrap registers the born agent in the control workspace when output differs from cwd', () => {
  const workspace = makeTempWorkspace();
  const outputDir = path.join(workspace, 'iot-development-agent');
  const result = runCli(
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
      '--telegram-bot-token',
      'telegram-token',
      '--json',
    ],
    { cwd: workspace, env: createBirthTestEnv() },
  );

  assert.equal(result.status, 0, result.stderr);

  const registryPath = path.join(workspace, '.collab', 'agents.json');
  const outputRegistryPath = path.join(outputDir, '.collab', 'agents.json');
  assert.equal(fs.existsSync(registryPath), true);
  assert.equal(fs.existsSync(outputRegistryPath), false);

  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  assert.equal(registry.agents.length, 1);
  assert.equal(registry.agents[0].id, 'agent.iot-developer-agent');
  assert.equal(registry.agents[0].rootDir, 'iot-development-agent');
  assert.equal(fs.existsSync(path.join(outputDir, '.collab', 'config.json')), true);
});

test('bootstrap supports CLI auth without asking or persisting a model override', () => {
  const workspace = makeTempWorkspace();
  const home = makeTempWorkspace();
  const env = createBirthTestEnv();
  env.HOME = home;

  const result = runCli(
    [
      '--cwd',
      workspace,
      'agent',
      'bootstrap',
      '--agent-name',
      'Codex Agent',
      '--operator-id',
      'operator.telegram.130149339',
      '--telegram-bot-token',
      'telegram-token',
      '--provider',
      'codex',
      '--provider-auth',
      'cli',
      '--json',
    ],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.agent.provider, 'codex');
  assert.equal(summary.agent.providerAuthMethod, 'cli');
  assert.equal(summary.agent.model, undefined);

  const configPayload = JSON.parse(
    fs.readFileSync(path.join(workspace, '.collab', 'config.json'), 'utf8'),
  );
  const envExample = fs.readFileSync(path.join(workspace, '.env.example'), 'utf8');

  assert.equal(configPayload.assistants.providers.codex.auth.method, 'cli');
  assert.equal(configPayload.assistants.providers.codex.model, undefined);
  assert.equal(configPayload.agent.defaultProviderAuthMethod, 'cli');
  assert.equal(configPayload.agent.defaultModel, undefined);
  assert.match(envExample, /^COLLAB_AGENT_AUTH_METHOD=cli$/m);
  assert.match(envExample, /^COLLAB_AGENT_MODEL=$/m);
  assert.doesNotMatch(envExample, /^COLLAB_BIRTH_PROVIDER=/m);
  assert.doesNotMatch(envExample, /^COLLAB_BIRTH_SHOW_THOUGHTS=/m);
});

test('bootstrap persists explicit self and assigned repositories', () => {
  const workspace = makeTempWorkspace();
  const result = runCli(
    [
      '--cwd',
      workspace,
      'agent',
      'bootstrap',
      '--agent-name',
      'QA Agent',
      '--operator-id',
      'operator.telegram.130149339',
      '--telegram-bot-token',
      'telegram-token',
      '--self-repository',
      'anystream/qa-agent',
      '--assigned-repositories',
      'anystream/api,anystream/web',
      '--json',
    ],
    { cwd: workspace, env: createBirthTestEnv() },
  );

  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.agent.selfRepository, 'anystream/qa-agent');
  assert.deepEqual(summary.agent.assignedRepositories, ['anystream/api', 'anystream/web']);

  const configPayload = JSON.parse(
    fs.readFileSync(path.join(workspace, '.collab', 'config.json'), 'utf8'),
  );
  const birthPayload = JSON.parse(
    fs.readFileSync(path.join(workspace, 'fixtures', 'qa-agent', 'agent-birth.json'), 'utf8'),
  );

  assert.equal(configPayload.agent.selfRepository, 'anystream/qa-agent');
  assert.deepEqual(configPayload.agent.assignedRepositories, ['anystream/api', 'anystream/web']);
  assert.equal(birthPayload.operating_boundaries.self_repository, 'anystream/qa-agent');
  assert.deepEqual(birthPayload.operating_boundaries.assigned_repositories, ['anystream/api', 'anystream/web']);
});

test('bootstrap accepts canonical cognitive MCP URL and wildcard egress', () => {
  const workspace = makeTempWorkspace();
  const result = runCli(
    [
      '--cwd',
      workspace,
      'agent',
      'bootstrap',
      '--agent-name',
      'Ops Agent',
      '--operator-id',
      'operator.telegram.130149339',
      '--telegram-bot-token',
      'telegram-token',
      '--cognitive-mcp-url',
      'http://localhost:8787/mcp',
      '--egress-url',
      '*',
      '--json',
    ],
    { cwd: workspace, env: createBirthTestEnv() },
  );

  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.agent.cognitiveMcpUrl, 'http://localhost:8787/mcp');

  const configPayload = JSON.parse(
    fs.readFileSync(path.join(workspace, '.collab', 'config.json'), 'utf8'),
  );
  const birthPayload = JSON.parse(
    fs.readFileSync(path.join(workspace, 'fixtures', 'ops-agent', 'agent-birth.json'), 'utf8'),
  );

  assert.equal(configPayload.agent.mcp.cognitive.serverUrl, 'http://localhost:8787/mcp');
  assert.equal(configPayload.agent.persistence.durableStateBackend, 'cognitive-mcp');
  assert.deepEqual(configPayload.agent.egress.allow, ['*']);
  assert.equal(
    birthPayload.operating_boundaries.cognitive_mcp_endpoint,
    'http://localhost:8787/mcp',
  );
  assert.deepEqual(birthPayload.operating_boundaries.egress_policy, ['*']);
});

test('bootstrap refuses to overwrite managed files without --force mode', () => {
  const workspace = makeTempWorkspace();
  const first = runCli(
    [
      '--cwd',
      workspace,
      'agent',
      'bootstrap',
      '--agent-name',
      'Collab Architect',
      '--operator-id',
      'operator.telegram.130149339',
      '--telegram-bot-token',
      'telegram-token',
    ],
    { cwd: workspace, env: createBirthTestEnv() },
  );
  const second = runCli(
    [
      '--cwd',
      workspace,
      'agent',
      'bootstrap',
      '--agent-name',
      'Collab Architect',
      '--operator-id',
      'operator.telegram.130149339',
      '--telegram-bot-token',
      'telegram-token',
    ],
    { cwd: workspace, env: createBirthTestEnv() },
  );

  assert.equal(first.status, 0, first.stderr);
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /Refusing to overwrite existing bootstrap files/i);
  assert.match(second.stderr, /--force overwrite|--force rebirth/i);
});

test('bootstrap overwrites managed files with --force overwrite', () => {
  const workspace = makeTempWorkspace();
  const birthPath = path.join(workspace, 'fixtures', 'collab-architect', 'agent-birth.json');

  const first = runCli(
    [
      '--cwd',
      workspace,
      'agent',
      'bootstrap',
      '--agent-name',
      'Collab Architect',
      '--operator-id',
      'operator.telegram.130149339',
      '--telegram-bot-token',
      'telegram-token',
    ],
    { cwd: workspace, env: createBirthTestEnv() },
  );
  assert.equal(first.status, 0, first.stderr);

  fs.writeFileSync(birthPath, '{"changed":true}\n', 'utf8');

  const second = runCli(
    [
      '--cwd',
      workspace,
      'agent',
      'bootstrap',
      '--agent-name',
      'Collab Architect',
      '--operator-id',
      'operator.telegram.130149339',
      '--telegram-bot-token',
      'telegram-token',
      '--force',
      'overwrite',
    ],
    { cwd: workspace, env: createBirthTestEnv() },
  );
  assert.equal(second.status, 0, second.stderr);

  const payload = JSON.parse(fs.readFileSync(birthPath, 'utf8'));
  assert.equal(payload.agent_id, 'agent.collab-architect');
});

test('bootstrap rejects invalid --force mode', () => {
  const workspace = makeTempWorkspace();
  const result = runCli(
    [
      '--cwd',
      workspace,
      'agent',
      'bootstrap',
      '--agent-name',
      'Collab Architect',
      '--operator-id',
      'operator.telegram.130149339',
      '--telegram-bot-token',
      'telegram-token',
      '--force',
      'everything',
    ],
    { cwd: workspace, env: createBirthTestEnv() },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid force mode 'everything'/i);
});

test('bootstrap uses existing output definitions as seed for --force overwrite', () => {
  const workspace = makeTempWorkspace();
  const draftPath = path.join(workspace, '.collab', 'agent-birth-wizard.json');

  const first = runCli(
    [
      '--cwd',
      workspace,
      'agent',
      'bootstrap',
      '--agent-name',
      'Existing IoT Agent',
      '--operator-id',
      'operator.telegram.130149339',
      '--telegram-bot-token',
      'telegram-token',
      '--scope',
      'anystream.iot',
      '--provider',
      'gemini',
      '--model',
      'gemini-2.5-pro',
      '--self-repository',
      'anystream/iot-development-agent',
      '--assigned-repositories',
      'anystream/balena-ws-player',
      '--json',
    ],
    { cwd: workspace, env: createBirthTestEnv() },
  );
  assert.equal(first.status, 0, first.stderr);

  fs.writeFileSync(
    draftPath,
    JSON.stringify(
      {
        version: 1,
        answers: {
          output: workspace,
          egressUrl: [],
        },
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  const second = runCli(
    [
      '--cwd',
      workspace,
      'agent',
      'birth',
      '--output',
      workspace,
      '--operator-id',
      'operator.telegram.130149339',
      '--telegram-bot-token',
      'telegram-token',
      '--force',
      'overwrite',
      '--json',
    ],
    { cwd: workspace, env: createBirthTestEnv() },
  );

  assert.equal(second.status, 0, second.stderr);
  const summary = JSON.parse(second.stdout);
  assert.equal(summary.agent.name, 'Existing IoT Agent');
  assert.equal(summary.agent.scope, 'anystream.iot');
  assert.equal(summary.agent.provider, 'gemini');
  assert.equal(summary.agent.model, 'gemini-2.5-pro');
  assert.equal(summary.agent.selfRepository, 'anystream/iot-development-agent');
  assert.deepEqual(summary.agent.assignedRepositories, ['anystream/balena-ws-player']);
  assert.equal(fs.existsSync(draftPath), false, 'stale wizard draft should be cleared after overwrite');
});
