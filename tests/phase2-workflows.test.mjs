import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createRequire } from 'node:module';
import { runCli } from './helpers/cli.mjs';
import { createFakeDockerEnv } from './helpers/fake-docker.mjs';
import { createBufferedLogger, createTestConfig } from './helpers/test-context.mjs';
import { makeTempWorkspace } from './helpers/workspace.mjs';

const require = createRequire(import.meta.url);
const { runOrchestration } = require('../dist/lib/orchestrator.js');
const { Executor } = require('../dist/lib/executor.js');

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
  const env = createFakeDockerEnv();
  // Isolate COLLAB_HOME to avoid git lock conflicts with parallel tests.
  env.COLLAB_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-home-'));

  const result = runCli(['--cwd', workspace, 'init', '--yes', '--skip-analysis'], {
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
  const env = createFakeDockerEnv();
  env.COLLAB_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-home-'));
  const configPath = writeExistingConfig(workspace, 'indexed');

  const result = runCli(['--cwd', workspace, 'init', '--yes', '--mode', 'file-only', '--skip-analysis'], {
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
  const env = createFakeDockerEnv();
  env.COLLAB_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-home-'));
  const configPath = writeExistingConfig(workspace, 'indexed');

  const result = runCli(['--cwd', workspace, 'init', '--yes', '--mode', 'file-only', '--force', '--skip-analysis'], {
    cwd: workspace,
    env,
  });

  assert.equal(result.status, 0, result.stderr);

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(config.mode, 'file-only');
});

test('init with mode=file-only does not contain infra or MCP stages', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(['--cwd', workspace, 'init', '--yes', '--mode', 'file-only', '--dry-run'], {
    cwd: workspace,
    env,
  });

  assert.equal(result.status, 0, result.stderr);
  // File-only pipeline has separate stages — infra/MCP are not in the pipeline at all
  assert.ok(
    !result.stdout.includes('Start infrastructure services'),
    'infra stage should not exist in file-only pipeline',
  );
  assert.ok(
    !result.stdout.includes('Start MCP service'),
    'MCP stage should not exist in file-only pipeline',
  );
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
  const config = createTestConfig(workspace);
  const stateFile = config.stateFile;
  fs.mkdirSync(config.collabDir, { recursive: true });

  const logs = [];
  const logger = createBufferedLogger(logs);

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
