import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

import { runCli } from '../helpers/cli.mjs';
import { callMcpTool, initializeMcpSession, listMcpTools } from '../helpers/mcp-http.mjs';
import { makeTempWorkspace } from '../helpers/workspace.mjs';

const SHOULD_RUN_E2E = process.env.COLLAB_RUN_E2E === '1';

async function waitForHealth(url, timeoutMs = 90_000) {
  const startedAt = Date.now();
  let lastError = '';

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      const body = await response.json();
      if (
        response.ok &&
        body?.dependencies?.qdrant === 'up' &&
        body?.dependencies?.nebula === 'up'
      ) {
        return body;
      }
      lastError = `health response: ${JSON.stringify(body)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error(`MCP health did not become ready in time: ${lastError}`);
}

function safeRunCli(args, cwd, timeout = 180_000) {
  return runCli(args, {
    cwd,
    timeout,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function cleanupDockerArtifacts() {
  spawnSync('docker', ['rm', '-f', 'collab-mcp', 'collab-qdrant', 'nebula-graphd', 'nebula-metad0', 'nebula-storaged0'], {
    stdio: 'ignore',
  });
  spawnSync(
    'docker',
    ['volume', 'rm', 'collab-mcp-data', 'collab-qdrant-data', 'collab-nebula-metad0', 'collab-nebula-storaged0'],
    { stdio: 'ignore' },
  );
  spawnSync('docker', ['network', 'rm', 'collab-network'], { stdio: 'ignore' });
}

// TODO: re-implement indexed E2E test with proper GitHub token and repo access.
// The previous test was removed because indexed mode now requires real GitHub
// auth and validated workspace repos, which are not available in CI.
