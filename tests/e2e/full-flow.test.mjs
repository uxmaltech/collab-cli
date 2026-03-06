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

test(
  'e2e: full flow from init indexed to MCP tool call',
  {
    skip: !SHOULD_RUN_E2E,
    timeout: 300_000,
  },
  async () => {
    const workspace = makeTempWorkspace();
    const composeFile = path.join(workspace, 'docker-compose.yml');
    const mcpBaseUrl = process.env.COLLAB_E2E_MCP_URL || 'http://127.0.0.1:7337';
    const mcpImageOverride = process.env.COLLAB_E2E_MCP_IMAGE;

    try {
      cleanupDockerArtifacts();

      if (mcpImageOverride) {
        fs.writeFileSync(path.join(workspace, '.env'), `MCP_IMAGE=${mcpImageOverride}\n`, 'utf8');
      }

      // Indexed mode requires a GitHub business canon and multi-repo workspace.
      // For e2e, use COLLAB_E2E_CANON env var or default to uxmaltech/collab-architecture.
      const canonRepo = process.env.COLLAB_E2E_CANON || 'uxmaltech/collab-architecture';
      const canonToken = process.env.COLLAB_E2E_GITHUB_TOKEN || '';

      // Create minimal multi-repo workspace structure for indexed mode
      fs.mkdirSync(path.join(workspace, 'test-repo', '.git'), { recursive: true });
      fs.mkdirSync(path.join(workspace, 'test-repo-2', '.git'), { recursive: true });

      const initArgs = [
        '--cwd', workspace, 'init', '--yes',
        '--business-canon', canonRepo,
        '--repos', 'test-repo,test-repo-2',
        '--mode', 'indexed',
        '--timeout-ms', '3000',
        '--retries', '40',
      ];
      if (canonToken) {
        initArgs.push('--github-token', canonToken);
      }

      const initResult = safeRunCli(initArgs, workspace, 300_000);
      assert.equal(
        initResult.status,
        0,
        `init failed\nstdout:\n${initResult.stdout}\n\nstderr:\n${initResult.stderr}`,
      );

      assert.equal(fs.existsSync(path.join(workspace, '.collab', 'config.json')), true);
      assert.equal(fs.existsSync(path.join(workspace, '.env')), true);
      assert.equal(fs.existsSync(composeFile), true);

      const health = await waitForHealth(`${mcpBaseUrl}/health`);
      assert.equal(health.status, 'ok');

      const sessionId = await initializeMcpSession(mcpBaseUrl);
      const tools = await listMcpTools(mcpBaseUrl, sessionId);
      assert.ok(tools.some((tool) => tool.name === 'context.scopes.list.v2'));

      const toolResult = await callMcpTool(mcpBaseUrl, sessionId, 'context.scopes.list.v2', {});
      assert.ok(toolResult, 'tool call did not return a result');
    } finally {
      safeRunCli(['--cwd', workspace, 'mcp', 'stop'], workspace);
      safeRunCli(['--cwd', workspace, 'infra', 'down'], workspace);

      if (fs.existsSync(composeFile)) {
        spawnSync('docker', ['compose', '-f', composeFile, 'down', '-v'], {
          cwd: workspace,
          stdio: 'ignore',
        });
      }

      cleanupDockerArtifacts();

      fs.rmSync(workspace, { recursive: true, force: true });
    }
  },
);
