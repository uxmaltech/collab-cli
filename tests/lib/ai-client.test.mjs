import assert from 'node:assert/strict';
import test from 'node:test';

// Import from compiled dist
const { createAiClient, createFirstAvailableClient } = await import('../../dist/lib/ai-client.js');

const baseConfig = {
  workspaceDir: '/tmp/test',
  collabDir: '/tmp/test/.collab',
  configFile: '/tmp/test/.collab/config.json',
  stateFile: '/tmp/test/.collab/state.json',
  envFile: '/tmp/test/.env',
  mode: 'file-only',
  compose: {
    consolidatedFile: 'docker-compose.yml',
    infraFile: 'docker-compose.infra.yml',
    mcpFile: 'docker-compose.mcp.yml',
  },
  architectureDir: '/tmp/test/docs/architecture',
};

const mockLogger = {
  info() {},
  debug() {},
  warn() {},
  error() {},
  result() {},
  command() {},
};

test('createAiClient returns null when no credentials available', async () => {
  // Temporarily clear env vars
  const saved = { ...process.env };
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;

  try {
    const client = await createAiClient('codex', baseConfig, mockLogger);
    assert.equal(client, null, 'should return null without credentials');
  } finally {
    Object.assign(process.env, saved);
  }
});

test('createAiClient creates a client when env var is set', async () => {
  const saved = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';

  try {
    const client = await createAiClient('codex', baseConfig, mockLogger);
    assert.ok(client !== null, 'should create client with API key');
    assert.equal(client.provider, 'codex');
    assert.equal(typeof client.complete, 'function');
  } finally {
    if (saved !== undefined) {
      process.env.OPENAI_API_KEY = saved;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  }
});

test('createFirstAvailableClient finds first available', async () => {
  const saved = { ...process.env };
  delete process.env.OPENAI_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

  try {
    const client = await createFirstAvailableClient(['codex', 'claude'], baseConfig, mockLogger);
    assert.ok(client !== null, 'should find claude as available');
    assert.equal(client.provider, 'claude');
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
    Object.assign(process.env, saved);
  }
});

test('createFirstAvailableClient returns null when none available', async () => {
  const saved = { ...process.env };
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;

  try {
    const client = await createFirstAvailableClient(['codex', 'claude', 'gemini'], baseConfig, mockLogger);
    assert.equal(client, null, 'should return null when none available');
  } finally {
    Object.assign(process.env, saved);
  }
});
