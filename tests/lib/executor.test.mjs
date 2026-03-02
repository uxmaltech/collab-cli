import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

import { makeTempWorkspace } from '../helpers/workspace.mjs';
import { createBufferedLogger } from '../helpers/test-context.mjs';

const require = createRequire(import.meta.url);
const { Executor } = require('../../dist/lib/executor.js');
const { CommandExecutionError } = require('../../dist/lib/errors.js');

test('executor dry-run has zero filesystem side effects and logs actions', () => {
  const workspace = makeTempWorkspace();
  const logs = [];
  const logger = createBufferedLogger(logs);
  const executor = new Executor(logger, { dryRun: true, cwd: workspace });

  const outputDir = path.join(workspace, 'tmp');
  const outputFile = path.join(outputDir, 'example.txt');

  const runResult = executor.run('node', ['-e', 'process.exit(99)']);
  executor.ensureDirectory(outputDir);
  executor.writeFile(outputFile, 'sample', { description: 'write sample file' });

  assert.equal(runResult.simulated, true);
  assert.equal(runResult.status, 0);
  assert.equal(fs.existsSync(outputDir), false);
  assert.equal(fs.existsSync(outputFile), false);
  assert.ok(logs.some((line) => line.includes('[dry-run] mkdir -p')));
  assert.ok(logs.some((line) => line.includes('[dry-run] write sample file:')));
});

test('executor writes files and creates parent directories when not in dry-run', () => {
  const workspace = makeTempWorkspace();
  const logger = createBufferedLogger();
  const executor = new Executor(logger, { dryRun: false, cwd: workspace });

  const outputFile = path.join(workspace, 'nested', 'dir', 'file.txt');
  executor.writeFile(outputFile, 'hello');

  assert.equal(fs.existsSync(outputFile), true);
  assert.equal(fs.readFileSync(outputFile, 'utf8'), 'hello');
});

test('executor throws CommandExecutionError on non-zero command exits', () => {
  const workspace = makeTempWorkspace();
  const logger = createBufferedLogger();
  const executor = new Executor(logger, { dryRun: false, cwd: workspace });

  assert.throws(
    () => executor.run('node', ['-e', 'process.stderr.write("boom\\n"); process.exit(3);']),
    (error) => {
      assert.ok(error instanceof CommandExecutionError);
      assert.equal(error.details.exitCode, 3);
      assert.match(error.details.stderr, /boom/);
      return true;
    },
  );
});
