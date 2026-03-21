import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../helpers/cli.mjs';
import { createFakeDockerEnv } from '../helpers/fake-docker.mjs';
import { makeTempWorkspace } from '../helpers/workspace.mjs';

function writeDevEnvWorkspace(workspace) {
  fs.mkdirSync(path.join(workspace, '.collab'), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, '.collab', 'config.json'),
    JSON.stringify(
      {
        mode: 'indexed',
        envFile: '.env',
        compose: {
          infraFile: 'infra/docker-compose.infra.yml',
          mcpFile: 'infra/docker-compose.mcp.yml',
        },
      },
      null,
      2,
    ),
    'utf8',
  );
  fs.writeFileSync(
    path.join(workspace, '.env'),
    [
      'COGNITIVE_MCP_URL=http://127.0.0.1:8787/mcp',
      'REDIS_PASSWORD=collab-dev-redis',
      '',
    ].join('\n'),
    'utf8',
  );
}

function writeBornAgentWorkspace(controlWorkspace, agentDirectoryName = 'iot-development-agent') {
  const agentRoot = path.join(controlWorkspace, agentDirectoryName);
  fs.mkdirSync(path.join(controlWorkspace, '.collab'), { recursive: true });
  fs.mkdirSync(path.join(agentRoot, '.collab'), { recursive: true });
  fs.writeFileSync(
    path.join(controlWorkspace, '.collab', 'agents.json'),
    JSON.stringify(
      {
        version: 1,
        agents: [
          {
            id: 'agent.iot-development-agent',
            name: 'IoT Development Agent',
            slug: 'iot-development-agent',
            scope: 'agent.iot-development-agent',
            rootDir: agentDirectoryName,
            entryFile: 'index.js',
            defaultArgs: ['development'],
            configFile: '.collab/config.json',
            birthFile: 'fixtures/iot-development-agent/agent-birth.json',
            selfRepository: 'anystream/iot-development-agent',
            assignedRepositories: ['anystream/balena-ws-player'],
            provider: 'codex',
            providerAuthMethod: 'cli',
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );
  fs.writeFileSync(
    path.join(agentRoot, '.collab', 'config.json'),
    JSON.stringify(
      {
        mode: 'indexed',
        envFile: '.env',
        compose: {
          consolidatedFile: 'infra/docker-compose.yml',
          infraFile: 'infra/docker-compose.infra.yml',
          mcpFile: 'infra/docker-compose.mcp.yml',
        },
      },
      null,
      2,
    ),
    'utf8',
  );
  fs.writeFileSync(
    path.join(agentRoot, '.env'),
    [
      'COGNITIVE_MCP_URL=http://127.0.0.1:8787/mcp',
      'REDIS_PASSWORD=collab-dev-redis',
      '',
    ].join('\n'),
    'utf8',
  );

  return agentRoot;
}

test('collab --help lists dev-env command', () => {
  const result = runCli(['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dev-env/);
});

test('collab dev-env start --help shows only the corrected MCP source flag', () => {
  const result = runCli(['dev-env', 'start', '--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /source-architecture-mcp/);
  assert.doesNotMatch(result.stdout, /source-architecure-mcp/);
  assert.match(result.stdout, /collab dev-env start/);
});

test('collab dev-env start uses an explicit local collab-architecture-mcp source in dry-run mode', () => {
  const workspace = makeTempWorkspace();
  writeDevEnvWorkspace(workspace);

  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-architecture-mcp-'));
  fs.writeFileSync(path.join(sourceDir, 'Dockerfile'), 'FROM alpine:3.20\n', 'utf8');

  const result = runCli(
    [
      '--cwd',
      workspace,
      '--dry-run',
      'dev-env',
      'start',
      '--source-architecture-mcp',
      sourceDir,
    ],
    {
      cwd: workspace,
      env: createFakeDockerEnv(),
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Using explicit collab-architecture-mcp source/);
  assert.match(result.stdout, new RegExp(sourceDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(result.stdout, /Generating collab-architecture-mcp infrastructure compose/);
  assert.match(result.stdout, /write dev-env infrastructure compose file/);
  assert.match(result.stdout, /write dev-env MCP Dockerfile/);
  assert.match(result.stdout, /write dev-env MCP compose file/);
  assert.match(result.stdout, /docker build/);
  assert.match(result.stdout, /docker compose/);
  assert.match(result.stdout, /Development environment started/);
});

test('collab dev-env start rejects the legacy typoed source flag', () => {
  const workspace = makeTempWorkspace();
  writeDevEnvWorkspace(workspace);

  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-architecture-mcp-'));
  fs.writeFileSync(path.join(sourceDir, 'Dockerfile'), 'FROM alpine:3.20\n', 'utf8');

  const result = runCli(
    [
      '--cwd',
      workspace,
      '--dry-run',
      'dev-env',
      'start',
      '--source-architecure-mcp',
      sourceDir,
    ],
    {
      cwd: workspace,
      env: createFakeDockerEnv(),
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown option '--source-architecure-mcp'/);
});

test('collab dev-env start resolves a single born agent workspace and generates missing compose files', () => {
  const workspace = makeTempWorkspace();
  const agentRoot = writeBornAgentWorkspace(workspace, 'iot-developmet-agent');

  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-architecture-mcp-'));
  fs.writeFileSync(path.join(sourceDir, 'Dockerfile'), 'FROM alpine:3.20\n', 'utf8');

  const result = runCli(
    [
      '--cwd',
      workspace,
      '--dry-run',
      'dev-env',
      'start',
      '--source-architecture-mcp',
      sourceDir,
    ],
    {
      cwd: workspace,
      env: createFakeDockerEnv(),
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Using born agent workspace for dev-env/);
  assert.match(result.stdout, new RegExp(agentRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(result.stdout, /Generating collab-architecture-mcp infrastructure compose/);
  assert.match(result.stdout, new RegExp(path.join(sourceDir, 'infra', 'docker-compose.yml').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(result.stdout, /Development environment started/);
});
