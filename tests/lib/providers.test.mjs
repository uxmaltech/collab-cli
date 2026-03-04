import assert from 'node:assert/strict';
import test from 'node:test';

const { parseProviderList, isProviderKey, autoDetectProviders, getEnabledProviders, PROVIDER_KEYS, PROVIDER_DEFAULTS } = await import('../../dist/lib/providers.js');

test('PROVIDER_KEYS contains expected providers', () => {
  assert.deepEqual([...PROVIDER_KEYS], ['codex', 'claude', 'gemini', 'copilot']);
});

test('PROVIDER_DEFAULTS has entries for all providers', () => {
  for (const key of PROVIDER_KEYS) {
    assert.ok(PROVIDER_DEFAULTS[key], `defaults missing for ${key}`);
    assert.ok(PROVIDER_DEFAULTS[key].label, `label missing for ${key}`);
    // copilot has no envVar or models — it uses gh CLI
    if (key !== 'copilot') {
      assert.ok(PROVIDER_DEFAULTS[key].envVar, `envVar missing for ${key}`);
      assert.ok(PROVIDER_DEFAULTS[key].models.length > 0, `models empty for ${key}`);
    }
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
        gemini: { enabled: true, auth: { method: 'api-key' } },
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

test('autoDetectProviders detects from environment and CLIs', async () => {
  const originalEnv = { ...process.env };

  try {
    // Clear any existing keys
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_AI_API_KEY;

    // Without env vars, autoDetectProviders may still detect installed CLIs on PATH
    const baseline = await autoDetectProviders();

    // Setting an env var should ensure that provider is detected
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const withAnthropic = await autoDetectProviders();
    assert.ok(withAnthropic.includes('claude'), 'should detect claude via ANTHROPIC_API_KEY');

    process.env.OPENAI_API_KEY = 'test-key';
    const withBoth = await autoDetectProviders();
    assert.ok(withBoth.includes('codex'), 'should detect codex via OPENAI_API_KEY');
    assert.ok(withBoth.includes('claude'), 'should detect claude via ANTHROPIC_API_KEY');

    // Env var detection should add to CLI-detected providers, not replace
    assert.ok(withBoth.length >= baseline.length, 'env vars should only add providers');
  } finally {
    // Restore original env
    process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY;
    process.env.ANTHROPIC_API_KEY = originalEnv.ANTHROPIC_API_KEY;
    process.env.GOOGLE_AI_API_KEY = originalEnv.GOOGLE_AI_API_KEY;
  }
});
