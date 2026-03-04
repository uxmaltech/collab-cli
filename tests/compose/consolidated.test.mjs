import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { assertSnapshot } from '../helpers/snapshot.mjs';
import { extractTemplateVariables, renderTemplateWithEnv } from '../helpers/template.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { consolidatedTemplate } = require('../../dist/templates/consolidated.js');
const { COMPOSE_ENV_DEFAULTS } = require('../../dist/lib/compose-defaults.js');

const expectedVariables = [
  'COLLAB_NETWORK',
  'MCP_API_KEYS',
  'MCP_CONTAINER_PORT',
  'MCP_ENV',
  'MCP_IMAGE',
  'MCP_PORT',
  'MCP_TECHNICAL_SCOPES',
  'MCP_VOLUME',
  'NEBULA_GRAPHD_HTTP_PORT',
  'NEBULA_GRAPHD_PORT',
  'NEBULA_METAD_HTTP_PORT',
  'NEBULA_METAD_PORT',
  'NEBULA_METAD_VOLUME',
  'NEBULA_STORAGED_HTTP_PORT',
  'NEBULA_STORAGED_PORT',
  'NEBULA_STORAGED_VOLUME',
  'NEBULA_VERSION',
  'QDRANT_IMAGE',
  'QDRANT_PORT',
  'QDRANT_VOLUME',
];

test('consolidated template matches snapshot baseline', () => {
  const snapshotFile = path.join(__dirname, '__snapshots__', 'consolidated.snap');
  assertSnapshot(snapshotFile, consolidatedTemplate);
});

test('consolidated template parameters are fully covered by defaults', () => {
  const variables = extractTemplateVariables(consolidatedTemplate);
  assert.deepEqual(variables, expectedVariables);

  for (const variable of variables) {
    assert.ok(variable in COMPOSE_ENV_DEFAULTS, `missing default for ${variable}`);
  }
});

test('consolidated template supports env override rendering', () => {
  const overrides = {
    ...COMPOSE_ENV_DEFAULTS,
    QDRANT_IMAGE: 'qdrant/qdrant:v9.9.9',
    NEBULA_VERSION: 'v9.9.9',
    MCP_IMAGE: 'ghcr.io/uxmaltech/collab-architecture-mcp:test',
    MCP_PORT: '18337',
    MCP_CONTAINER_PORT: '7337',
    MCP_API_KEYS: 'cli:secret-token',
  };

  const rendered = renderTemplateWithEnv(consolidatedTemplate, overrides);

  assert.match(rendered, /qdrant\/qdrant:v9\.9\.9/);
  assert.match(rendered, /vesoft\/nebula-metad:v9\.9\.9/);
  assert.match(rendered, /ghcr\.io\/uxmaltech\/collab-architecture-mcp:test/);
  assert.match(rendered, /"18337:7337"/);
  assert.match(rendered, /MCP_API_KEYS: cli:secret-token/);
});
