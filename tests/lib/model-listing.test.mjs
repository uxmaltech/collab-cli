import assert from 'node:assert/strict';
import test from 'node:test';

// The listModels function makes real HTTP calls, so we only test it
// with a real API key if available. Otherwise we verify the module loads.
const { listModels } = await import('../../dist/lib/model-listing.js');

test('listModels is a function', () => {
  assert.equal(typeof listModels, 'function');
});

test('listModels rejects with invalid Gemini key', async () => {
  await assert.rejects(
    () => listModels('gemini', 'invalid-key'),
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('Gemini API error'), `Unexpected error: ${err.message}`);
      return true;
    },
  );
});

test('listModels rejects with invalid OpenAI key', async () => {
  await assert.rejects(
    () => listModels('codex', 'invalid-key'),
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('OpenAI API error'), `Unexpected error: ${err.message}`);
      return true;
    },
  );
});

test('listModels rejects with invalid Anthropic key', async () => {
  await assert.rejects(
    () => listModels('claude', 'invalid-key'),
    (err) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('Anthropic API error'), `Unexpected error: ${err.message}`);
      return true;
    },
  );
});

// Integration test: runs only when GOOGLE_AI_API_KEY is set and valid
test('listModels returns Gemini models with valid key', { skip: !process.env.GOOGLE_AI_API_KEY }, async () => {
  const models = await listModels('gemini', process.env.GOOGLE_AI_API_KEY);

  assert.ok(Array.isArray(models), 'should return an array');
  assert.ok(models.length > 0, 'should return at least one model');

  // Every model should have an id
  for (const m of models) {
    assert.ok(typeof m.id === 'string' && m.id.length > 0, `model should have an id: ${JSON.stringify(m)}`);
  }

  // Should include some gemini model
  const hasGemini = models.some((m) => m.id.includes('gemini'));
  assert.ok(hasGemini, 'should include a gemini model');
});
