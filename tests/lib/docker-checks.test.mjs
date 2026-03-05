import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

import { createBufferedLogger } from '../helpers/test-context.mjs';

const require = createRequire(import.meta.url);
const { Executor } = require('../../dist/lib/executor.js');
const { checkDockerDaemon, checkDockerImages } = require('../../dist/lib/docker-checks.js');

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

test('checkDockerDaemon returns ok=false when docker is not in PATH', () => {
  const logger = createBufferedLogger();
  const executor = new Executor(logger, { dryRun: false, cwd: process.cwd() });

  const result = withPath('', () => checkDockerDaemon(executor));

  assert.equal(result.ok, false);
  assert.match(result.error, /not found/);
});

test('checkDockerDaemon returns dry-run result when in dry-run mode', () => {
  const logger = createBufferedLogger();
  const executor = new Executor(logger, { dryRun: true, cwd: process.cwd() });

  const result = checkDockerDaemon(executor);

  assert.equal(result.ok, true);
  assert.equal(result.version, 'dry-run');
});

test('checkDockerDaemon returns version when daemon is running', () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-docker-'));
  writeExecutable(
    binDir,
    'docker',
    '#!/bin/sh\necho "26.1.0"\n',
  );

  const logger = createBufferedLogger();
  const executor = new Executor(logger, { dryRun: false, cwd: process.cwd() });

  const result = withPath(binDir, () => checkDockerDaemon(executor));

  assert.equal(result.ok, true);
  assert.equal(result.version, '26.1.0');
});

test('checkDockerDaemon detects daemon-not-running error', () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-docker-'));
  writeExecutable(
    binDir,
    'docker',
    '#!/bin/sh\necho "Cannot connect to the Docker daemon" >&2\nexit 1\n',
  );

  const logger = createBufferedLogger();
  const executor = new Executor(logger, { dryRun: false, cwd: process.cwd() });

  const result = withPath(binDir, () => checkDockerDaemon(executor));

  assert.equal(result.ok, false);
  assert.match(result.error, /not running/i);
});

test('checkDockerImages returns ok=false when docker is not in PATH', () => {
  const logger = createBufferedLogger();
  const executor = new Executor(logger, { dryRun: false, cwd: process.cwd() });

  const results = withPath('', () => checkDockerImages(executor, ['my-image:latest']));

  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  assert.match(results[0].error, /not found/);
});

test('checkDockerImages returns dry-run result', () => {
  const logger = createBufferedLogger();
  const executor = new Executor(logger, { dryRun: true, cwd: process.cwd() });

  const results = checkDockerImages(executor, ['img-a:latest', 'img-b:v1']);

  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.ok));
});

test('checkDockerImages reports missing image', () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-docker-'));
  writeExecutable(
    binDir,
    'docker',
    '#!/bin/sh\necho "No such image" >&2\nexit 1\n',
  );

  const logger = createBufferedLogger();
  const executor = new Executor(logger, { dryRun: false, cwd: process.cwd() });

  const results = withPath(binDir, () => checkDockerImages(executor, ['missing:latest']));

  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  assert.match(results[0].error, /not found locally/i);
});

test('checkDockerImages reports found image', () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-docker-'));
  writeExecutable(
    binDir,
    'docker',
    '#!/bin/sh\necho "sha256:abc123"\n',
  );

  const logger = createBufferedLogger();
  const executor = new Executor(logger, { dryRun: false, cwd: process.cwd() });

  const results = withPath(binDir, () => checkDockerImages(executor, ['found:latest']));

  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true);
});
