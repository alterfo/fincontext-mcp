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

  test('POST tools/list without a Pro-key returns only the open tools', async () => {
    const res = await handler(post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }));
    const body = JSON.parse(res.body);
    const names = body.result.tools.map((t) => t.name).sort();
    expect(names).toEqual(['check_payment', 'get_cash_position']);
  });

  test('POST tools/call for a premium tool without a Pro-key returns the upgrade error', async () => {
    const res = await handler(
      post({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'reconcile', arguments: {} },
      })
    );
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe(-32001);
    expect(body.error.data.upgrade_url).toBeDefined();
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

  test('GET / serves the landing HTML', async () => {
    const res = await handler({ httpMethod: 'GET', path: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toMatch(/text\/html/);
    expect(res.body).toContain('FinContext MCP');
    expect(res.body).toContain('data-tool="get_cash_position"');
    expect(res.body).toContain('data-tool="check_payment"');
    expect(res.body).toContain('data-tool="reconcile"');
    expect(res.body).toContain('data-tool="cashgap_forecast"');
  });

  test('GET / with a query string still serves the landing HTML', async () => {
    const res = await handler({ httpMethod: 'GET', path: '/?utm=x' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toMatch(/text\/html/);
    expect(res.body).toContain('FinContext MCP');
  });

  test('routes via requestContext.path when event.path is absent', async () => {
    const res = await handler({
      httpMethod: 'POST',
      requestContext: { path: '/mcp' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'initialize', params: {} }),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).result.serverInfo.name).toBe('fincontext-mcp');
  });

  test('unsupported methods are rejected with 405', async () => {
    const res = await handler({ httpMethod: 'DELETE', path: '/mcp' });
    expect(res.statusCode).toBe(405);
  });

  test('POST / (root) still handles JSON-RPC', async () => {
    const res = await handler(
      post({ jsonrpc: '2.0', id: 9, method: 'initialize', params: {} }, { path: '/' })
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).result.serverInfo.name).toBe('fincontext-mcp');
  });

  const demo = (tool) =>
    handler({
      httpMethod: 'POST',
      path: '/demo',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool }),
    });

  test('POST /demo get_cash_position returns the frozen cash total', async () => {
    const res = await demo('get_cash_position');
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.tool).toBe('get_cash_position');
    expect(body.result.total.amount).toBe(45000000);
    expect(body.result.total.currency).toBe('RUB');
  });

  test('POST /demo check_payment returns a confident found match', async () => {
    const res = await demo('check_payment');
    const body = JSON.parse(res.body);
    expect(body.result.status).toBe('found');
    expect(body.result.matches[0].confidence).toBeGreaterThanOrEqual(0.5);
  });

  test('POST /demo reconcile returns 6 matches and the three exception types', async () => {
    const res = await demo('reconcile');
    const body = JSON.parse(res.body);
    expect(body.result.summary.matched).toBe(6);
    const types = body.result.exceptions.map((e) => e.type).sort();
    expect(types).toEqual(['missing_in_bank', 'missing_in_ledger', 'partial_payment']);
  });

  test('POST /demo cashgap_forecast predicts the gap on the salary date', async () => {
    const res = await demo('cashgap_forecast');
    const body = JSON.parse(res.body);
    expect(body.result.gap.will_occur).toBe(true);
    expect(body.result.gap.first_gap_date).toBe('2026-08-12');
    expect(body.result.gap.deficit_amount).toBe(25000000);
  });

  test('POST /demo rejects an unknown tool with 404', async () => {
    const res = await handler({
      httpMethod: 'POST',
      path: '/demo',
      body: JSON.stringify({ tool: 'nope' }),
    });
    expect(res.statusCode).toBe(404);
  });

  test('POST /demo with an invalid JSON body returns 400 with CORS headers', async () => {
    const res = await handler({ httpMethod: 'POST', path: '/demo', body: '{not json' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Parse error/);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
  });

  test('GET /demo is not routed to the demo handler', async () => {
    const res = await handler({ httpMethod: 'GET', path: '/demo' });
    expect(res.statusCode).toBe(405);
  });

  test('premium demo tools run without a Pro-key on demo data', async () => {
    const res = await demo('reconcile');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).result.summary).toBeDefined();
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
