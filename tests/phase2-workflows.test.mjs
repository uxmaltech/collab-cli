import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import os from 'node:os';

import { createRequire } from 'node:module';
import { runCli } from './helpers/cli.mjs';
import { makeTempWorkspace } from './helpers/workspace.mjs';

const require = createRequire(import.meta.url);
const { runOrchestration } = require('../dist/lib/orchestrator.js');
const { Executor } = require('../dist/lib/executor.js');

function fakeDockerEnv() {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-cli-bin-'));
  const dockerPath = path.join(binDir, 'docker');
  fs.writeFileSync(
    dockerPath,
    `#!/bin/sh
if [ "$1" = "compose" ] && [ "$2" = "version" ]; then
  echo "Docker Compose version v2.0.0"
  exit 0
fi
if [ "$1" = "compose" ]; then
  exit 0
fi
echo "Docker version 0.0.0"
exit 0
`,
    'utf8',
  );
  fs.chmodSync(dockerPath, 0o755);
  return {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH || ''}`,
  };
}

function writeExistingConfig(workspace, mode = 'indexed') {
  const collabDir = path.join(workspace, '.collab');
  const configPath = path.join(collabDir, 'config.json');
  fs.mkdirSync(collabDir, { recursive: true });
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        mode,
        compose: {
          consolidatedFile: 'docker-compose.yml',
          infraFile: 'docker-compose.infra.yml',
          mcpFile: 'docker-compose.mcp.yml',
        },
        envFile: '.env',
      },
      null,
      2,
    ),
    'utf8',
  );
  return configPath;
}

test('init --yes defaults to file-only mode and stores it in config', () => {
  const workspace = makeTempWorkspace();
  const env = fakeDockerEnv();

  const result = runCli(['--cwd', workspace, 'init', '--yes'], {
    cwd: workspace,
    env,
  });

  assert.equal(result.status, 0, result.stderr);

  const configPath = path.join(workspace, '.collab', 'config.json');
  assert.equal(fs.existsSync(configPath), true);

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(config.mode, 'file-only');
});

test('init preserves existing config without --force', () => {
  const workspace = makeTempWorkspace();
  const env = fakeDockerEnv();
  const configPath = writeExistingConfig(workspace, 'indexed');

  const result = runCli(['--cwd', workspace, 'init', '--yes', '--mode', 'file-only'], {
    cwd: workspace,
    env,
  });

  assert.equal(result.status, 0, result.stderr);

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(config.mode, 'indexed');
  assert.match(result.stdout, /preserving it\. use --force to overwrite/i);
});

test('init overwrites existing config with --force', () => {
  const workspace = makeTempWorkspace();
  const env = fakeDockerEnv();
  const configPath = writeExistingConfig(workspace, 'indexed');

  const result = runCli(['--cwd', workspace, 'init', '--yes', '--mode', 'file-only', '--force'], {
    cwd: workspace,
    env,
  });

  assert.equal(result.status, 0, result.stderr);

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(config.mode, 'file-only');
});

test('init with mode=file-only skips infra and MCP stages', () => {
  const workspace = makeTempWorkspace();
  const env = fakeDockerEnv();

  const result = runCli(['--cwd', workspace, 'init', '--yes', '--mode', 'file-only', '--dry-run'], {
    cwd: workspace,
    env,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /skipping infra startup stage/i);
  assert.match(result.stdout, /skipping mcp startup stage/i);
});

test('up command skips pipeline in file-only mode', () => {
  const workspace = makeTempWorkspace();

  const result = runCli(['--cwd', workspace, 'up', '--mode', 'file-only'], {
    cwd: workspace,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Mode file-only: skipping infra and MCP startup pipeline/);
});

test('orchestrator persists progress and resume skips completed stages', async () => {
  const workspace = makeTempWorkspace();
  const collabDir = path.join(workspace, '.collab');
  const stateFile = path.join(collabDir, 'state.json');

  fs.mkdirSync(collabDir, { recursive: true });

  const config = {
    workspaceDir: workspace,
    collabDir,
    configFile: path.join(collabDir, 'config.json'),
    stateFile,
    envFile: path.join(workspace, '.env'),
    mode: 'file-only',
    compose: {
      consolidatedFile: 'docker-compose.yml',
      infraFile: 'docker-compose.infra.yml',
      mcpFile: 'docker-compose.mcp.yml',
    },
  };

  const logs = [];
  const logger = {
    verbosity: 'normal',
    info(message) {
      logs.push(message);
    },
    debug(message) {
      logs.push(message);
    },
    warn(message) {
      logs.push(message);
    },
    error(message) {
      logs.push(message);
    },
    result(message) {
      logs.push(message);
    },
    command(parts) {
      logs.push(parts.join(' '));
    },
  };

  const executor = new Executor(logger, { dryRun: false, cwd: workspace });

  const firstStageRuns = [];

  await assert.rejects(
    runOrchestration(
      {
        workflowId: 'init',
        config,
        executor,
        logger,
        resume: false,
      },
      [
        {
          id: 'stage-1',
          title: 'Stage One',
          recovery: ['retry stage one'],
          run: () => {
            firstStageRuns.push('stage-1');
          },
        },
        {
          id: 'stage-2',
          title: 'Stage Two',
          recovery: ['retry stage two'],
          run: () => {
            throw new Error('simulated failure');
          },
        },
      ],
    ),
  );

  const persistedAfterFailure = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.deepEqual(persistedAfterFailure.workflows.init.completedStages, ['stage-1']);
  assert.equal(persistedAfterFailure.workflows.init.failure.stage, 'stage-2');

  const resumedRuns = [];

  await runOrchestration(
    {
      workflowId: 'init',
      config,
      executor,
      logger,
      resume: true,
    },
    [
      {
        id: 'stage-1',
        title: 'Stage One',
        recovery: ['retry stage one'],
        run: () => {
          resumedRuns.push('stage-1');
        },
      },
      {
        id: 'stage-2',
        title: 'Stage Two',
        recovery: ['retry stage two'],
        run: () => {
          resumedRuns.push('stage-2');
        },
      },
    ],
  );

  assert.deepEqual(resumedRuns, ['stage-2']);

  const persistedAfterResume = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.deepEqual(persistedAfterResume.workflows.init.completedStages, ['stage-1', 'stage-2']);
  assert.equal(persistedAfterResume.workflows.init.failure, undefined);
});
