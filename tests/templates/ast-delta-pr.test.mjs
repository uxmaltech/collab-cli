import assert from 'node:assert/strict';
import test from 'node:test';

import { astDeltaPrTemplate } from '../../dist/templates/ci/index.js';

test('astDeltaPrTemplate is a non-empty string', () => {
  assert.equal(typeof astDeltaPrTemplate, 'string');
  assert.ok(astDeltaPrTemplate.length > 0);
});

test('astDeltaPrTemplate contains expected content', () => {
  assert.ok(astDeltaPrTemplate.includes('AST Delta Extraction'), 'should contain workflow name');
  assert.ok(astDeltaPrTemplate.includes('pull_request'), 'should trigger on pull_request');
  assert.ok(astDeltaPrTemplate.includes('ci ast-delta'), 'should call collab ci ast-delta');
  assert.ok(astDeltaPrTemplate.includes('MCP_BASE_URL'), 'should reference MCP_BASE_URL secret');
  assert.ok(astDeltaPrTemplate.includes('MCP_API_KEY'), 'should reference MCP_API_KEY secret');
  assert.ok(astDeltaPrTemplate.includes('fetch-depth: 0'), 'should do full checkout for diff');
  assert.ok(astDeltaPrTemplate.includes('continue-on-error'), 'should have graceful degradation');
});

test('astDeltaPrTemplate includes architecture impact comment step', () => {
  assert.ok(astDeltaPrTemplate.includes('AST_IMPACT_FILE'), 'should reference AST_IMPACT_FILE env var');
  assert.ok(astDeltaPrTemplate.includes('Post architecture impact comment'), 'should have comment posting step');
  assert.ok(astDeltaPrTemplate.includes('actions/github-script@v7'), 'should use github-script action');
  assert.ok(astDeltaPrTemplate.includes('pull-requests: write'), 'should declare pull-requests write permission');
  assert.ok(astDeltaPrTemplate.includes('collab:architecture-impact'), 'should use stable HTML comment marker');
  assert.ok(astDeltaPrTemplate.includes('github.paginate'), 'should paginate comments');
  assert.ok(astDeltaPrTemplate.includes('github-actions[bot]'), 'should check bot ownership');
});
