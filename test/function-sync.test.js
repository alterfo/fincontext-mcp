'use strict';

const { createLockbox } = require('../src/lockbox');

describe('sync FaaS handler', () => {
  const saved = {};
  beforeAll(() => {
    for (const key of ['LOCKBOX_TOCHKA_TOKEN', 'LOCKBOX_MOYSKLAD_TOKEN']) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });
  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('runs with no configured tokens and returns a well-formed body', async () => {
    const { handler } = require('../functions/sync/index');
    const res = await handler({}, {});
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.sources).toEqual([]);
    expect(body.totals).toEqual({});
    expect(body.gap).toBeDefined();
    expect(body.alerts).toBeDefined();
  });

  test('resolveSources builds a connector per source that has a token', async () => {
    const { resolveSources } = require('../functions/sync/index');
    const lockbox = createLockbox({
      resolver: async () => ({ entries: { token: 'tok-abc' } }),
      secrets: { tochka: { secret_id: 's-tochka' } },
    });
    const made = [];
    const factories = {
      tochka: (token) => {
        made.push(['tochka', token]);
        return { source: 'tochka' };
      },
      moysklad: (token) => {
        made.push(['moysklad', token]);
        return { source: 'moysklad' };
      },
    };
    const sources = await resolveSources(lockbox, factories);
    expect(made).toEqual([['tochka', 'tok-abc']]);
    expect(sources).toHaveLength(1);
    expect(sources[0].connector.source).toBe('tochka');
  });
});
