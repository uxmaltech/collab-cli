import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  parseComposePs,
  buildServiceStatusList,
  SERVICE_LABELS,
} = require('../../dist/lib/docker-status.js');

// ── parseComposePs ──────────────────────────────────────────────

test('parseComposePs parses valid JSON lines', () => {
  const stdout = [
    '{"Name":"proj-qdrant-1","Service":"qdrant","State":"running","Status":"Up 2 hours","Ports":"0.0.0.0:6333->6333/tcp","Health":"healthy"}',
    '{"Name":"proj-graphd-1","Service":"graphd","State":"running","Status":"Up 2 hours","Ports":"0.0.0.0:9669->9669/tcp","Health":""}',
  ].join('\n');

  const result = parseComposePs(stdout);
  assert.equal(result.length, 2);
  assert.equal(result[0].service, 'qdrant');
  assert.equal(result[0].state, 'running');
  assert.equal(result[0].name, 'proj-qdrant-1');
  assert.equal(result[0].health, 'healthy');
  assert.equal(result[1].service, 'graphd');
  assert.equal(result[1].ports, '0.0.0.0:9669->9669/tcp');
});

test('parseComposePs returns empty array for empty input', () => {
  assert.deepEqual(parseComposePs(''), []);
  assert.deepEqual(parseComposePs('  \n  '), []);
});

test('parseComposePs skips malformed JSON lines', () => {
  const stdout = [
    '{"Name":"proj-qdrant-1","Service":"qdrant","State":"running","Status":"Up 2 hours","Ports":"","Health":""}',
    'this is not json',
    '{"Name":"proj-graphd-1","Service":"graphd","State":"running","Status":"Up 1 hour","Ports":"","Health":""}',
  ].join('\n');

  const result = parseComposePs(stdout);
  assert.equal(result.length, 2);
  assert.equal(result[0].service, 'qdrant');
  assert.equal(result[1].service, 'graphd');
});

test('parseComposePs handles lowercase field names', () => {
  const stdout =
    '{"name":"c1","service":"mcp","state":"running","status":"Up 30m","ports":"7337/tcp","health":"healthy"}';
  const result = parseComposePs(stdout);
  assert.equal(result.length, 1);
  assert.equal(result[0].service, 'mcp');
  assert.equal(result[0].state, 'running');
  assert.equal(result[0].status, 'Up 30m');
});

// ── buildServiceStatusList ──────────────────────────────────────

test('buildServiceStatusList merges containers and health results', () => {
  const containers = [
    {
      name: 'qdrant-1',
      service: 'qdrant',
      state: 'running',
      status: 'Up 2h',
      ports: '0.0.0.0:6333->6333/tcp',
      health: '',
    },
  ];
  const healthResults = [
    {
      name: 'qdrant',
      ok: true,
      attempts: 1,
      detail: 'HTTP 200 from http://127.0.0.1:6333/collections',
    },
  ];

  const result = buildServiceStatusList(['qdrant'], containers, healthResults);
  assert.equal(result.length, 1);
  assert.equal(result[0].running, true);
  assert.equal(result[0].healthOk, true);
  assert.ok(result[0].healthDetail.includes('HTTP 200'));
  assert.equal(result[0].ports, '6333/tcp');
});

test('buildServiceStatusList shows "Not running" for missing containers', () => {
  const result = buildServiceStatusList(['qdrant', 'graphd'], [], []);
  assert.equal(result.length, 2);
  assert.equal(result[0].running, false);
  assert.equal(result[0].status, 'Not running');
  assert.equal(result[1].running, false);
  assert.equal(result[1].status, 'Not running');
});

test('buildServiceStatusList uses SERVICE_LABELS for known services', () => {
  const result = buildServiceStatusList(['qdrant', 'mcp'], [], []);
  assert.equal(result[0].label, 'Qdrant (Vector DB)');
  assert.equal(result[1].label, 'MCP Server');
});

test('buildServiceStatusList falls back to service name for unknown services', () => {
  const result = buildServiceStatusList(['custom-svc'], [], []);
  assert.equal(result[0].label, 'custom-svc');
});

test('buildServiceStatusList sets healthOk to null when no health result', () => {
  const containers = [
    {
      name: 'metad0-1',
      service: 'metad0',
      state: 'running',
      status: 'Up 1h',
      ports: '',
      health: '',
    },
  ];

  const result = buildServiceStatusList(['metad0'], containers, []);
  assert.equal(result[0].running, true);
  assert.equal(result[0].healthOk, null);
  assert.equal(result[0].healthDetail, '');
});

// ── SERVICE_LABELS ──────────────────────────────────────────────

test('SERVICE_LABELS covers all known services', () => {
  const expected = ['qdrant', 'metad0', 'storaged0', 'graphd', 'mcp'];
  for (const svc of expected) {
    assert.ok(SERVICE_LABELS[svc], `Missing label for service: ${svc}`);
  }
});
