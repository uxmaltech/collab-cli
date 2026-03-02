import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

import { makeTempWorkspace } from '../helpers/workspace.mjs';
import { createBufferedLogger, createTestConfig } from '../helpers/test-context.mjs';

const require = createRequire(import.meta.url);
const { runOrchestration } = require('../../dist/lib/orchestrator.js');
const { Executor } = require('../../dist/lib/executor.js');
const { CommandExecutionError, CliError } = require('../../dist/lib/errors.js');

test('orchestrator failure includes command, stderr, and recovery actions', async () => {
  const workspace = makeTempWorkspace();
  const config = createTestConfig(workspace);
  fs.mkdirSync(config.collabDir, { recursive: true });

  const logs = [];
  const logger = createBufferedLogger(logs);
  const executor = new Executor(logger, { dryRun: false, cwd: workspace });

  await assert.rejects(
    runOrchestration(
      {
        workflowId: 'orchestrator-error-format',
        config,
        executor,
        logger,
      },
      [
        {
          id: 'failure-stage',
          title: 'Failure Stage',
          recovery: ['run collab init --resume', 'inspect docker compose logs'],
          run: () => {
            throw new CommandExecutionError('command failed', {
              command: 'docker compose -f docker-compose.yml up -d',
              exitCode: 1,
              stderr: 'container failed to start',
              stdout: '',
            });
          },
        },
      ],
    ),
    (error) => {
      assert.ok(error instanceof CliError);
      assert.match(error.message, /Stage 'failure-stage' failed/);
      assert.match(error.message, /docker compose -f docker-compose\.yml up -d/);
      assert.match(error.message, /stderr:/);
      assert.match(error.message, /container failed to start/);
      assert.match(error.message, /Recovery actions:/);
      assert.match(error.message, /run collab init --resume/);
      return true;
    },
  );

  const state = JSON.parse(fs.readFileSync(config.stateFile, 'utf8'));
  assert.equal(state.workflows['orchestrator-error-format'].failure.stage, 'failure-stage');
  assert.equal(
    state.workflows['orchestrator-error-format'].failure.command,
    'docker compose -f docker-compose.yml up -d',
  );
});
