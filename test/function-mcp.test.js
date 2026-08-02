'use strict';

const { handler } = require('../functions/mcp/index');

const post = (bodyObj, extra = {}) => ({
  httpMethod: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj),
  ...extra,
});

describe('MCP FaaS handler', () => {
  test('POST initialize returns a 200 JSON-RPC result', async () => {
    const res = await handler(post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(res.body);
    expect(body.result.serverInfo.name).toBe('fincontext-mcp');
  });

  test('POST tools/list returns the four tools', async () => {
    const res = await handler(post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }));
    const body = JSON.parse(res.body);
    expect(body.result.tools).toHaveLength(4);
  });

  test('decodes base64-encoded bodies from the API Gateway', async () => {
    const raw = JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'ping', params: {} });
    const res = await handler(
      post(Buffer.from(raw).toString('base64'), { isBase64Encoded: true })
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).result).toEqual({});
  });

  test('invalid JSON body -> parse error (200 with JSON-RPC error)', async () => {
    const res = await handler(post('{not json'));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).error.code).toBe(-32700);
  });

  test('GET is rejected with 405', async () => {
    const res = await handler({ httpMethod: 'GET' });
    expect(res.statusCode).toBe(405);
  });

  test('OPTIONS preflight returns 204 with CORS headers', async () => {
    const res = await handler({ httpMethod: 'OPTIONS' });
    expect(res.statusCode).toBe(204);
    expect(res.headers['Access-Control-Allow-Methods']).toContain('POST');
  });

  test('notification-only POST returns 202 with empty body', async () => {
    const res = await handler(post({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    expect(res.statusCode).toBe(202);
    expect(res.body).toBe('');
  });
});
