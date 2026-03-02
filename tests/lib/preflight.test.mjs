import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

import { createBufferedLogger } from '../helpers/test-context.mjs';

const require = createRequire(import.meta.url);
const { Executor } = require('../../dist/lib/executor.js');
const { runPreflightChecks } = require('../../dist/lib/preflight.js');

function writeExecutable(binDir, name, script) {
  const fullPath = path.join(binDir, name);
  fs.writeFileSync(fullPath, script, 'utf8');
  fs.chmodSync(fullPath, 0o755);
}

function withPath(pathValue, run) {
  const previous = process.env.PATH;
  process.env.PATH = pathValue;
  try {
    return run();
  } finally {
    process.env.PATH = previous;
  }
}

test('preflight reports missing commands', () => {
  const logger = createBufferedLogger();
  const executor = new Executor(logger, { dryRun: false, cwd: process.cwd() });

  const checks = withPath('', () => runPreflightChecks(executor));
  const nodeCheck = checks.find((item) => item.id === 'node');

  assert.ok(nodeCheck);
  assert.equal(nodeCheck.ok, false);
  assert.match(nodeCheck.detail, /not found in PATH/);
});

test('preflight marks version probe failures as failed checks', () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-cli-preflight-'));
  writeExecutable(binDir, 'node', '#!/bin/sh\necho "v20.0.0"\nexit 0\n');
  writeExecutable(binDir, 'npm', '#!/bin/sh\necho "probe failed" 1>&2\nexit 2\n');
  writeExecutable(binDir, 'python3', '#!/bin/sh\necho "Python 3.12.0"\nexit 0\n');
  writeExecutable(
    binDir,
    'docker',
    '#!/bin/sh\nif [ "$1" = "compose" ] && [ "$2" = "version" ]; then echo "Docker Compose v2"; exit 0; fi\necho "Docker version 26.0.0"\nexit 0\n',
  );

  const logger = createBufferedLogger();
  const executor = new Executor(logger, { dryRun: false, cwd: process.cwd() });
  const checks = withPath(binDir, () => runPreflightChecks(executor));

  const npmCheck = checks.find((item) => item.id === 'npm');
  const composeCheck = checks.find((item) => item.id === 'docker-compose-plugin');

  assert.ok(npmCheck);
  assert.equal(npmCheck.ok, false);
  assert.match(npmCheck.detail, /probe failed|exited with code 2/i);

  assert.ok(composeCheck);
  assert.equal(composeCheck.ok, true);
});
