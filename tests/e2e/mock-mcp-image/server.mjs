import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 7337);

function sendJson(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function mcpSuccess(id, result) {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, {
      status: 'ok',
      dependencies: {
        qdrant: 'up',
        nebula: 'up',
      },
    });
    return;
  }

  // ── HTTP API endpoints used by graph-seed and canon-ingest stages ──

  if (req.method === 'POST' && req.url === '/api/v1/seed/graph') {
    sendJson(res, 200, {
      nodes_created: 0,
      edges_created: 0,
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/v1/ingest') {
    sendJson(res, 200, {
      vector: {
        ingested_files: 0,
        total_points: 0,
        collection: 'mock',
      },
      graph: {
        nodes_created: 0,
        edges_created: 0,
        space: 'mock',
      },
    });
    return;
  }

  // ── MCP JSON-RPC endpoint ──

  if (req.method === 'POST' && req.url === '/mcp') {
    let payload = {};
    try {
      payload = await parseJsonBody(req);
    } catch {
      sendJson(res, 400, {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: 'Parse error',
        },
      });
      return;
    }

    const method = payload?.method;
    const requestId = payload?.id ?? null;

    if (method === 'initialize') {
      const sessionId = crypto.randomUUID();
      sendJson(
        res,
        200,
        mcpSuccess(requestId, {
          protocolVersion: '2025-03-26',
          serverInfo: {
            name: 'collab-mcp-mock',
            version: '0.1.0',
          },
          capabilities: {
            tools: {},
          },
        }),
        {
          'mcp-session-id': sessionId,
        },
      );
      return;
    }

    if (method === 'notifications/initialized') {
      sendJson(res, 200, {});
      return;
    }

    if (method === 'tools/list') {
      sendJson(
        res,
        200,
        mcpSuccess(requestId, {
          tools: [
            {
              name: 'architecture.scopes.list',
              description: 'Mock scope listing tool for collab-cli E2E workflow',
              inputSchema: {
                type: 'object',
                properties: {},
                additionalProperties: false,
              },
            },
          ],
        }),
      );
      return;
    }

    if (method === 'tools/call') {
      const toolName = payload?.params?.name;
      if (toolName !== 'architecture.scopes.list') {
        sendJson(res, 404, {
          jsonrpc: '2.0',
          id: requestId,
          error: {
            code: -32601,
            message: `Unknown tool: ${toolName}`,
          },
        });
        return;
      }

      sendJson(
        res,
        200,
        mcpSuccess(requestId, {
          content: [
            {
              type: 'text',
              text: '{"scopes":[]}',
            },
          ],
          structuredContent: {
            scopes: [],
          },
        }),
      );
      return;
    }

    sendJson(res, 404, {
      jsonrpc: '2.0',
      id: requestId,
      error: {
        code: -32601,
        message: `Method not found: ${String(method || '')}`,
      },
    });
    return;
  }

  sendJson(res, 404, {
    error: 'Not found',
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Mock MCP server listening on ${PORT}`);
});
