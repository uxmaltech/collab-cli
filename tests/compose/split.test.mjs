import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { assertSnapshot } from '../helpers/snapshot.mjs';
import { extractTemplateVariables, renderTemplateWithEnv } from '../helpers/template.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { infraTemplate } = require('../../dist/templates/infra.js');
const { mcpTemplate } = require('../../dist/templates/mcp.js');
const { COMPOSE_ENV_DEFAULTS } = require('../../dist/lib/compose-defaults.js');

const expectedInfraVariables = [
  'COLLAB_NETWORK',
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

const expectedMcpVariables = [
  'COLLAB_NETWORK',
  'MCP_API_KEYS',
  'MCP_CONTAINER_PORT',
  'MCP_ENV',
  'MCP_IMAGE',
  'MCP_PORT',
  'MCP_VOLUME',
];

test('split templates match snapshot baselines', () => {
  assertSnapshot(path.join(__dirname, '__snapshots__', 'infra.snap'), infraTemplate);
  assertSnapshot(path.join(__dirname, '__snapshots__', 'mcp.snap'), mcpTemplate);
});

test('split template parameters are fully covered by defaults', () => {
  const infraVariables = extractTemplateVariables(infraTemplate);
  const mcpVariables = extractTemplateVariables(mcpTemplate);
  assert.deepEqual(infraVariables, expectedInfraVariables);
  assert.deepEqual(mcpVariables, expectedMcpVariables);

  for (const variable of [...infraVariables, ...mcpVariables]) {
    assert.ok(variable in COMPOSE_ENV_DEFAULTS, `missing default for ${variable}`);
  }
});

test('split templates support custom ports and image tags', () => {
  const overrides = {
    ...COMPOSE_ENV_DEFAULTS,
    QDRANT_PORT: '16333',
    NEBULA_GRAPHD_PORT: '19669',
    MCP_IMAGE: 'ghcr.io/uxmaltech/collab-architecture-mcp:v3-test',
    MCP_PORT: '17337',
    MCP_CONTAINER_PORT: '7338',
  };

  const renderedInfra = renderTemplateWithEnv(infraTemplate, overrides);
  const renderedMcp = renderTemplateWithEnv(mcpTemplate, overrides);

  assert.match(renderedInfra, /"16333:6333"/);
  assert.match(renderedInfra, /"19669:9669"/);
  assert.match(renderedMcp, /ghcr\.io\/uxmaltech\/collab-architecture-mcp:v3-test/);
  assert.match(renderedMcp, /"17337:7338"/);
});

test('split templates handle optional values without leaking undefined', () => {
  const withoutApiKeys = {
    ...COMPOSE_ENV_DEFAULTS,
    MCP_API_KEYS: '',
  };
  const rendered = renderTemplateWithEnv(mcpTemplate, withoutApiKeys);

  assert.match(rendered, /MCP_API_KEYS:\s*$/m);
  assert.doesNotMatch(rendered, /undefined/);
});
