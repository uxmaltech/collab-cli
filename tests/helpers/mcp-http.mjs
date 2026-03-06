import assert from 'node:assert/strict';

async function postJson(url, payload, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let body = {};
  if (text.trim()) {
    body = JSON.parse(text);
  }

  return {
    response,
    body,
  };
}

export async function initializeMcpSession(baseUrl) {
  const initPayload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      clientInfo: {
        name: 'collab-cli-e2e',
        version: '0.1.0',
      },
      capabilities: {},
    },
  };

  const { response, body } = await postJson(`${baseUrl}/mcp`, initPayload);
  assert.equal(response.ok, true, `initialize failed: ${JSON.stringify(body)}`);

  const sessionId = response.headers.get('mcp-session-id');
  assert.ok(sessionId, 'missing mcp-session-id header after initialize');

  if (body.error) {
    throw new Error(`initialize returned error: ${JSON.stringify(body.error)}`);
  }

  const initializedNotification = {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {},
  };
  await postJson(`${baseUrl}/mcp`, initializedNotification, { 'mcp-session-id': sessionId });

  return sessionId;
}

export async function listMcpTools(baseUrl, sessionId) {
  const payload = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  };
  const { response, body } = await postJson(`${baseUrl}/mcp`, payload, { 'mcp-session-id': sessionId });
  assert.equal(response.ok, true, `tools/list failed: ${JSON.stringify(body)}`);
  if (body.error) {
    throw new Error(`tools/list returned error: ${JSON.stringify(body.error)}`);
  }
  return body.result?.tools ?? [];
}

export async function callMcpTool(baseUrl, sessionId, name, args = {}) {
  const payload = {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name,
      arguments: args,
    },
  };
  const { response, body } = await postJson(`${baseUrl}/mcp`, payload, { 'mcp-session-id': sessionId });
  assert.equal(response.ok, true, `tools/call failed: ${JSON.stringify(body)}`);
  if (body.error) {
    throw new Error(`tools/call returned error: ${JSON.stringify(body.error)}`);
  }
  return body.result;
}
