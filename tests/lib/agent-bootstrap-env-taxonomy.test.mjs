import assert from 'node:assert/strict';
import test from 'node:test';

const {
  detectBirthLlmProviders,
  prevalidateBirthWizardMode,
  resolveBirthLlmModel,
} = await import('../../dist/lib/agent-bootstrap/env-taxonomy.js');

test('detectBirthLlmProviders prefers GEMINI_API_KEY for gemini runtime agents', () => {
  const savedGemini = process.env.GEMINI_API_KEY;
  const savedGeminiModel = process.env.GEMINI_MODEL;
  const savedOpenAi = process.env.OPENAI_API_KEY;

  process.env.GEMINI_API_KEY = 'gemini-key';
  process.env.GEMINI_MODEL = 'gemini-2.5-pro';
  process.env.OPENAI_API_KEY = 'openai-key';

  try {
    const providers = detectBirthLlmProviders('codex');
    assert.equal(providers[0]?.provider, 'gemini');
    assert.equal(providers[0]?.apiKeyEnvVar, 'GEMINI_API_KEY');
  } finally {
    if (savedGemini === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = savedGemini;
    }
    if (savedGeminiModel === undefined) {
      delete process.env.GEMINI_MODEL;
    } else {
      process.env.GEMINI_MODEL = savedGeminiModel;
    }
    if (savedOpenAi === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = savedOpenAi;
    }
  }
});

test('detectBirthLlmProviders keeps Gemini first even for non-Gemini runtime providers', () => {
  const savedGemini = process.env.GEMINI_API_KEY;
  const savedGeminiModel = process.env.GEMINI_MODEL;
  const savedOpenAi = process.env.OPENAI_API_KEY;
  const savedOpenAiModel = process.env.OPENAI_MODEL;

  process.env.GEMINI_API_KEY = 'gemini-key';
  process.env.GEMINI_MODEL = 'gemini-2.5-pro';
  process.env.OPENAI_API_KEY = 'openai-key';
  process.env.OPENAI_MODEL = 'gpt-4.1';

  try {
    const providers = detectBirthLlmProviders('codex');
    assert.equal(providers[0]?.provider, 'gemini');
    assert.equal(providers[1]?.provider, 'openai');
  } finally {
    if (savedGemini === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = savedGemini;
    }
    if (savedGeminiModel === undefined) {
      delete process.env.GEMINI_MODEL;
    } else {
      process.env.GEMINI_MODEL = savedGeminiModel;
    }
    if (savedOpenAi === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = savedOpenAi;
    }
    if (savedOpenAiModel === undefined) {
      delete process.env.OPENAI_MODEL;
    } else {
      process.env.OPENAI_MODEL = savedOpenAiModel;
    }
  }
});

test('resolveBirthLlmModel uses defaults or explicit overrides', () => {
  const saved = process.env.GEMINI_MODEL;
  delete process.env.GEMINI_MODEL;

  try {
    assert.equal(resolveBirthLlmModel('gemini'), 'gemini-2.5-pro');
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    assert.equal(resolveBirthLlmModel('gemini'), 'gemini-2.5-flash');
  } finally {
    if (saved === undefined) {
      delete process.env.GEMINI_MODEL;
    } else {
      process.env.GEMINI_MODEL = saved;
    }
  }
});

test('detectBirthLlmProviders skips xAI when XAI_MODEL is missing', () => {
  const savedKey = process.env.XAI_API_KEY;
  const savedModel = process.env.XAI_MODEL;
  process.env.XAI_API_KEY = 'xai-key';
  delete process.env.XAI_MODEL;

  try {
    const providers = detectBirthLlmProviders('codex');
    assert.equal(providers.some((provider) => provider.provider === 'xai'), false);
  } finally {
    if (savedKey === undefined) {
      delete process.env.XAI_API_KEY;
    } else {
      process.env.XAI_API_KEY = savedKey;
    }
    if (savedModel === undefined) {
      delete process.env.XAI_MODEL;
    } else {
      process.env.XAI_MODEL = savedModel;
    }
  }
});

test('detectBirthLlmProviders accepts CLAUDE_* aliases for Anthropic birth assistants', () => {
  const savedApiKey = process.env.CLAUDE_API_KEY;
  const savedModel = process.env.CLAUDE_MODEL;
  const savedAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const savedAnthropicModel = process.env.ANTHROPIC_MODEL;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_MODEL;
  process.env.CLAUDE_API_KEY = 'claude-key';
  process.env.CLAUDE_MODEL = 'claude-sonnet-4-20250514';

  try {
    const providers = detectBirthLlmProviders('claude');
    const anthropic = providers.find((provider) => provider.provider === 'anthropic');
    assert.equal(anthropic?.apiKeyEnvVar, 'CLAUDE_API_KEY');
    assert.equal(anthropic?.modelEnvVar, 'CLAUDE_MODEL');
  } finally {
    if (savedApiKey === undefined) {
      delete process.env.CLAUDE_API_KEY;
    } else {
      process.env.CLAUDE_API_KEY = savedApiKey;
    }
    if (savedModel === undefined) {
      delete process.env.CLAUDE_MODEL;
    } else {
      process.env.CLAUDE_MODEL = savedModel;
    }
    if (savedAnthropicKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = savedAnthropicKey;
    }
    if (savedAnthropicModel === undefined) {
      delete process.env.ANTHROPIC_MODEL;
    } else {
      process.env.ANTHROPIC_MODEL = savedAnthropicModel;
    }
  }
});

test('prevalidateBirthWizardMode enables conversational mode when a birth provider is available', () => {
  const savedGemini = process.env.GEMINI_API_KEY;
  const savedModel = process.env.GEMINI_MODEL;
  process.env.GEMINI_API_KEY = 'gemini-key';
  process.env.GEMINI_MODEL = 'gemini-2.5-pro';

  try {
    const mode = prevalidateBirthWizardMode('codex');
    assert.equal(mode.mode, 'conversational');
    assert.equal(mode.selectedProvider?.provider, 'gemini');
    assert.match(mode.reason, /GEMINI_API_KEY/);
  } finally {
    if (savedGemini === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = savedGemini;
    }
    if (savedModel === undefined) {
      delete process.env.GEMINI_MODEL;
    } else {
      process.env.GEMINI_MODEL = savedModel;
    }
  }
});
