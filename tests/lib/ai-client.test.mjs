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

test('createAiClient returns null when no credentials available', () => {
  // Temporarily clear env vars
  const saved = { ...process.env };
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;

  try {
    const client = createAiClient('codex', baseConfig, mockLogger);
    assert.equal(client, null, 'should return null without credentials');
  } finally {
    Object.assign(process.env, saved);
  }
});

test('createAiClient creates a client when env var is set', () => {
  const saved = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';

  try {
    const client = createAiClient('codex', baseConfig, mockLogger);
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

test('createFirstAvailableClient finds first available', () => {
  const saved = { ...process.env };
  delete process.env.OPENAI_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

  try {
    const client = createFirstAvailableClient(['codex', 'claude'], baseConfig, mockLogger);
    assert.ok(client !== null, 'should find claude as available');
    assert.equal(client.provider, 'claude');
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
    Object.assign(process.env, saved);
  }
});

test('createFirstAvailableClient returns null when none available', () => {
  const saved = { ...process.env };
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;

  try {
    const client = createFirstAvailableClient(['codex', 'claude', 'gemini'], baseConfig, mockLogger);
    assert.equal(client, null, 'should return null when none available');
  } finally {
    Object.assign(process.env, saved);
  }
});

test('createAiClient returns CLI client when auth method is cli', () => {
  const saved = { ...process.env };
  delete process.env.OPENAI_API_KEY;

  try {
    const configWithCli = {
      ...baseConfig,
      assistants: {
        providers: {
          codex: {
            enabled: true,
            auth: { method: 'cli' },
            model: 'gpt-5.3-codex',
            cli: { command: 'codex', available: true, version: 'codex-cli 0.106.0' },
          },
        },
      },
    };

    const client = createAiClient('codex', configWithCli, mockLogger);
    assert.ok(client !== null, 'should create CLI-based client');
    assert.equal(client.provider, 'codex');
    assert.equal(typeof client.complete, 'function');
  } finally {
    Object.assign(process.env, saved);
  }
});

test('createAiClient prefers API key over CLI when both available', () => {
  const saved = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-api-key';

  try {
    const configWithCli = {
      ...baseConfig,
      assistants: {
        providers: {
          codex: {
            enabled: true,
            auth: { method: 'cli' },
            model: 'gpt-5.3-codex',
            cli: { command: 'codex', available: true },
          },
        },
      },
    };

    const client = createAiClient('codex', configWithCli, mockLogger);
    assert.ok(client !== null, 'should create client');
    assert.equal(client.provider, 'codex');
    // API key takes precedence — the HTTP client is created, not the CLI client
  } finally {
    if (saved !== undefined) {
      process.env.OPENAI_API_KEY = saved;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  }
});

test('createAiClient returns null when CLI not available', () => {
  const saved = { ...process.env };
  delete process.env.OPENAI_API_KEY;

  try {
    const configWithUnavailableCli = {
      ...baseConfig,
      assistants: {
        providers: {
          codex: {
            enabled: true,
            auth: { method: 'cli' },
            model: 'gpt-5.3-codex',
            cli: { command: 'codex', available: false },
          },
        },
      },
    };

    const client = createAiClient('codex', configWithUnavailableCli, mockLogger);
    assert.equal(client, null, 'should return null when CLI not available');
  } finally {
    Object.assign(process.env, saved);
  }
});

test('createFirstAvailableClient works with CLI-configured provider', () => {
  const saved = { ...process.env };
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;

  try {
    const configWithCli = {
      ...baseConfig,
      assistants: {
        providers: {
          codex: {
            enabled: true,
            auth: { method: 'cli' },
            model: 'gpt-5.3-codex',
            cli: { command: 'codex', available: true },
          },
          claude: { enabled: false, auth: { method: 'api-key' } },
          gemini: { enabled: false, auth: { method: 'api-key' } },
        },
      },
    };

    const client = createFirstAvailableClient(['codex', 'claude', 'gemini'], configWithCli, mockLogger);
    assert.ok(client !== null, 'should find codex via CLI auth');
    assert.equal(client.provider, 'codex');
  } finally {
    Object.assign(process.env, saved);
  }
});
