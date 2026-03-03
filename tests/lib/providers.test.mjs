import assert from 'node:assert/strict';
import test from 'node:test';

const { parseProviderList, isProviderKey, autoDetectProviders, getEnabledProviders, PROVIDER_KEYS, PROVIDER_DEFAULTS } = await import('../../dist/lib/providers.js');

test('PROVIDER_KEYS contains expected providers', () => {
  assert.deepEqual([...PROVIDER_KEYS], ['codex', 'claude', 'gemini']);
});

test('PROVIDER_DEFAULTS has entries for all providers', () => {
  for (const key of PROVIDER_KEYS) {
    assert.ok(PROVIDER_DEFAULTS[key], `defaults missing for ${key}`);
    assert.ok(PROVIDER_DEFAULTS[key].label, `label missing for ${key}`);
    assert.ok(PROVIDER_DEFAULTS[key].envVar, `envVar missing for ${key}`);
    assert.ok(PROVIDER_DEFAULTS[key].models.length > 0, `models empty for ${key}`);
    assert.ok(PROVIDER_DEFAULTS[key].authMethods.length > 0, `authMethods empty for ${key}`);
    assert.ok(PROVIDER_DEFAULTS[key].oauth, `oauth config missing for ${key}`);
    assert.ok(PROVIDER_DEFAULTS[key].oauth.authorizationUrl, `oauth authorizationUrl missing for ${key}`);
    assert.ok(PROVIDER_DEFAULTS[key].oauth.tokenUrl, `oauth tokenUrl missing for ${key}`);
  }
});

test('isProviderKey validates known providers', () => {
  assert.equal(isProviderKey('codex'), true);
  assert.equal(isProviderKey('claude'), true);
  assert.equal(isProviderKey('gemini'), true);
  assert.equal(isProviderKey('unknown'), false);
  assert.equal(isProviderKey(''), false);
});

test('parseProviderList parses comma-separated providers', () => {
  assert.deepEqual(parseProviderList('codex'), ['codex']);
  assert.deepEqual(parseProviderList('codex,claude'), ['codex', 'claude']);
  assert.deepEqual(parseProviderList('codex,claude,gemini'), ['codex', 'claude', 'gemini']);
});

test('parseProviderList handles whitespace', () => {
  assert.deepEqual(parseProviderList(' codex , claude '), ['codex', 'claude']);
});

test('parseProviderList deduplicates', () => {
  assert.deepEqual(parseProviderList('codex,codex,claude'), ['codex', 'claude']);
});

test('parseProviderList throws on invalid provider', () => {
  assert.throws(
    () => parseProviderList('codex,invalid'),
    /Invalid provider 'invalid'/,
  );
});

test('parseProviderList handles empty string', () => {
  assert.deepEqual(parseProviderList(''), []);
});

test('getEnabledProviders returns enabled providers from config', () => {
  const config = {
    assistants: {
      providers: {
        codex: { enabled: true, auth: { method: 'api-key' } },
        claude: { enabled: false, auth: { method: 'api-key' } },
        gemini: { enabled: true, auth: { method: 'oauth' } },
      },
    },
  };

  const enabled = getEnabledProviders(config);
  assert.deepEqual(enabled, ['codex', 'gemini']);
});

test('getEnabledProviders returns empty array when no assistants configured', () => {
  assert.deepEqual(getEnabledProviders({}), []);
  assert.deepEqual(getEnabledProviders({ assistants: null }), []);
  assert.deepEqual(getEnabledProviders({ assistants: { providers: {} } }), []);
});

test('autoDetectProviders detects from environment', () => {
  const originalEnv = { ...process.env };

  try {
    // Clear any existing keys
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_AI_API_KEY;
    delete process.env.OPENAI_CLIENT_ID;
    delete process.env.ANTHROPIC_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;

    assert.deepEqual(autoDetectProviders(), []);

    process.env.ANTHROPIC_API_KEY = 'test-key';
    assert.deepEqual(autoDetectProviders(), ['claude']);

    process.env.OPENAI_API_KEY = 'test-key';
    assert.deepEqual(autoDetectProviders(), ['codex', 'claude']);
  } finally {
    // Restore original env
    process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY;
    process.env.ANTHROPIC_API_KEY = originalEnv.ANTHROPIC_API_KEY;
    process.env.GOOGLE_AI_API_KEY = originalEnv.GOOGLE_AI_API_KEY;
    process.env.OPENAI_CLIENT_ID = originalEnv.OPENAI_CLIENT_ID;
    process.env.ANTHROPIC_CLIENT_ID = originalEnv.ANTHROPIC_CLIENT_ID;
    process.env.GOOGLE_CLIENT_ID = originalEnv.GOOGLE_CLIENT_ID;
  }
});

test('autoDetectProviders detects OAuth client IDs', () => {
  const originalEnv = { ...process.env };

  try {
    // Clear all keys
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_AI_API_KEY;
    delete process.env.OPENAI_CLIENT_ID;
    delete process.env.ANTHROPIC_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;

    // Only OAuth client ID set (no API key)
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    assert.deepEqual(autoDetectProviders(), ['gemini']);

    process.env.OPENAI_CLIENT_ID = 'test-client-id';
    assert.deepEqual(autoDetectProviders(), ['codex', 'gemini']);
  } finally {
    process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY;
    process.env.ANTHROPIC_API_KEY = originalEnv.ANTHROPIC_API_KEY;
    process.env.GOOGLE_AI_API_KEY = originalEnv.GOOGLE_AI_API_KEY;
    process.env.OPENAI_CLIENT_ID = originalEnv.OPENAI_CLIENT_ID;
    process.env.ANTHROPIC_CLIENT_ID = originalEnv.ANTHROPIC_CLIENT_ID;
    process.env.GOOGLE_CLIENT_ID = originalEnv.GOOGLE_CLIENT_ID;
  }
});

test('OAuth URLs are valid HTTPS URLs', () => {
  for (const key of PROVIDER_KEYS) {
    const oauth = PROVIDER_DEFAULTS[key].oauth;
    assert.ok(oauth.authorizationUrl.startsWith('https://'), `${key} authorizationUrl should be HTTPS`);
    assert.ok(oauth.tokenUrl.startsWith('https://'), `${key} tokenUrl should be HTTPS`);
  }
});
