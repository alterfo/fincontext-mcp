'use strict';

const { createConnectorTemplate, normalizeRow } = require('../src/connectors/_template');

function fakeHttp(rows) {
  return async () => ({ ok: true, status: 200, json: async () => ({ rows }) });
}

describe('connector template', () => {
  test('normalizes marketplace rows into the unified model', () => {
    const tx = normalizeRow(
      { id: 'p-1', type: 'payout', amount: '12345.60', date: '2026-08-01', order_number: 'OZ-777' },
      { source: 'ozon' }
    );
    expect(tx.source).toBe('ozon');
    expect(tx.kind).toBe('marketplace');
    expect(tx.direction).toBe('in');
    expect(tx.amount).toBe(1234560);
    expect(tx.doc_number).toBe('OZ-777');
  });

  test('commission rows are outflows, planned payouts are pending', () => {
    const commission = normalizeRow({ id: 'c-1', type: 'commission', amount: 500, date: '2026-08-01' }, { source: 'wb' });
    expect(commission.direction).toBe('out');
    const planned = normalizeRow({ id: 'p-2', type: 'payout', amount: 1000, date: '2026-08-20', status: 'planned' }, { source: 'wb' });
    expect(planned.status).toBe('pending');
  });

  test('pull returns the unified connector shape', async () => {
    const connector = createConnectorTemplate({
      source: 'ozon',
      token: 't',
      http: fakeHttp([
        { id: '1', type: 'payout', amount: 200000, date: '2026-08-01' },
        { id: '2', type: 'commission', amount: 15000, date: '2026-08-01' },
      ]),
    });
    const out = await connector.pull({ from: '2026-07-01', to: '2026-08-31' });
    expect(out.accounts).toEqual([]);
    expect(out.statements).toEqual([]);
    expect(out.transactions).toHaveLength(2);
    expect(out.transactions.every((t) => t.kind === 'marketplace')).toBe(true);
  });

  test('pull requires a token', async () => {
    const connector = createConnectorTemplate({ source: 'ozon', http: fakeHttp([]) });
    await expect(connector.pull({})).rejects.toThrow(/token required/);
  });
});
