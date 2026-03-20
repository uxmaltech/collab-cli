import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

import { createBufferedLogger, createTestConfig } from '../helpers/test-context.mjs';
import { makeTempWorkspace } from '../helpers/workspace.mjs';

const require = createRequire(import.meta.url);
const { Executor } = require('../../dist/lib/executor.js');
const { agentSkillsSetupStage } = require('../../dist/stages/agent-skills-setup.js');

test('agent-skills-setup writes canonical architecture MCP tool names in indexed mode', () => {
  const workspace = makeTempWorkspace();
  const logs = [];
  const logger = createBufferedLogger(logs);
  const config = createTestConfig(workspace, {
    mode: 'indexed',
    assistants: {
      providers: {
        claude: {
          enabled: true,
          auth: {
            method: 'api-key',
            envVar: 'ANTHROPIC_API_KEY',
          },
        },
      },
    },
  });
  const executor = new Executor(logger, { dryRun: false, cwd: workspace });

  agentSkillsSetupStage.run({ config, executor, logger });

  const claudeMd = fs.readFileSync(path.join(workspace, 'CLAUDE.md'), 'utf8');
  assert.match(claudeMd, /architecture\.scopes\.list/);
  assert.match(claudeMd, /architecture\.vector\.search/);
  assert.match(claudeMd, /architecture\.graph\.degree\.search/);
  assert.doesNotMatch(claudeMd, /context\./);
  assert.doesNotMatch(claudeMd, /\.v2/);
});
