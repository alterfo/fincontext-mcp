'use strict';

const {
  handleRequest,
  handleMessage,
  visibleTools,
  PROTOCOL_VERSION,
  SERVER_INFO,
  ERROR,
} = require('../src/mcp');
const { TOOLS } = require('../src/tools');

const rpc = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, params });

describe('initialize', () => {
  test('returns protocol version, server info and tool capability', async () => {
    const res = await handleRequest(rpc('initialize', {}));
    expect(res.jsonrpc).toBe('2.0');
    expect(res.id).toBe(1);
    expect(res.result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(res.result.serverInfo).toEqual(SERVER_INFO);
    expect(res.result.capabilities.tools).toBeDefined();
  });
});

describe('tools/list', () => {
  test('advertises all four tools with valid inputSchema (Task 1, no license)', async () => {
    const res = await handleRequest(rpc('tools/list', {}));
    const names = res.result.tools.map((t) => t.name).sort();
    expect(names).toEqual(['cashgap_forecast', 'check_payment', 'get_cash_position', 'reconcile']);
    for (const tool of res.result.tools) {
      expect(typeof tool.description).toBe('string');
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  test('does not leak internal metadata (premium/module) into list entries', async () => {
    const res = await handleRequest(rpc('tools/list', {}));
    for (const tool of res.result.tools) {
      expect(tool).not.toHaveProperty('premium');
      expect(tool).not.toHaveProperty('module');
    }
  });

  test('filters premium tools when unlockedModules is provided', async () => {
    const res = await handleRequest(rpc('tools/list', {}), { unlockedModules: [] });
    const names = res.result.tools.map((t) => t.name).sort();
    expect(names).toEqual(['check_payment', 'get_cash_position']);
  });

  test('unlocking a module surfaces its premium tool', async () => {
    const res = await handleRequest(rpc('tools/list', {}), { unlockedModules: ['reconcile'] });
    const names = res.result.tools.map((t) => t.name);
    expect(names).toContain('reconcile');
    expect(names).not.toContain('cashgap_forecast');
  });
});

describe('visibleTools', () => {
  test('returns every tool when no module list is supplied', () => {
    expect(visibleTools(undefined)).toHaveLength(TOOLS.length);
  });
});

describe('tools/call routing', () => {
  test('unknown tool -> METHOD_NOT_FOUND', async () => {
    const res = await handleRequest(rpc('tools/call', { name: 'nope', arguments: {} }));
    expect(res.error.code).toBe(ERROR.METHOD_NOT_FOUND);
  });

  test('registered but unwired tool -> not-implemented internal error', async () => {
    const res = await handleRequest(rpc('tools/call', { name: 'get_cash_position', arguments: {} }));
    expect(res.error.code).toBe(ERROR.INTERNAL);
    expect(res.error.data.not_implemented).toBe(true);
  });

  test('dispatches to a provided handler with arguments and context', async () => {
    const handler = jest.fn(async (args) => ({ echoed: args }));
    const res = await handleRequest(
      rpc('tools/call', { name: 'get_cash_position', arguments: { currency: 'RUB' } }),
      { handlers: { get_cash_position: handler } }
    );
    expect(handler).toHaveBeenCalledWith({ currency: 'RUB' }, expect.any(Object));
    expect(res.result).toEqual({ echoed: { currency: 'RUB' } });
  });

  test('premium tool without unlocked module -> UPGRADE_REQUIRED with upgrade_url', async () => {
    const res = await handleRequest(
      rpc('tools/call', { name: 'reconcile', arguments: {} }),
      { unlockedModules: [] }
    );
    expect(res.error.code).toBe(ERROR.UPGRADE_REQUIRED);
    expect(res.error.data.upgrade_url).toBeDefined();
  });
});

describe('protocol edge cases', () => {
  test('unknown method -> METHOD_NOT_FOUND', async () => {
    const res = await handleRequest(rpc('does/not/exist', {}));
    expect(res.error.code).toBe(ERROR.METHOD_NOT_FOUND);
  });

  test('malformed request -> INVALID_REQUEST', async () => {
    const res = await handleRequest({ foo: 'bar' });
    expect(res.error.code).toBe(ERROR.INVALID_REQUEST);
  });

  test('notification (no id) returns null', async () => {
    const res = await handleRequest({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(res).toBeNull();
  });

  test('ping returns empty result', async () => {
    const res = await handleRequest(rpc('ping', {}));
    expect(res.result).toEqual({});
  });
});

describe('batch handling', () => {
  test('processes a batch and drops notification responses', async () => {
    const batch = [
      rpc('initialize', {}, 1),
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      rpc('tools/list', {}, 2),
    ];
    const res = await handleMessage(batch);
    expect(Array.isArray(res)).toBe(true);
    expect(res).toHaveLength(2);
    expect(res.map((r) => r.id).sort()).toEqual([1, 2]);
  });

  test('empty batch -> INVALID_REQUEST', async () => {
    const res = await handleMessage([]);
    expect(res.error.code).toBe(ERROR.INVALID_REQUEST);
  });
});
