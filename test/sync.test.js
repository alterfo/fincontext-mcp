'use strict';

const { createStore, createMemoryBackend } = require('../src/ydb');
const { makeTransaction } = require('../src/model');
const { incrementalSync, isoMinusDays, WATERMARK_ACCOUNT } = require('../src/sync');

function bankTx(accountId, nativeId, direction, amount, bookedAt) {
  return makeTransaction({
    source: 'tochka',
    kind: 'bank',
    account_id: accountId,
    native_id: nativeId,
    direction,
    amount,
    booked_at: bookedAt,
    status: 'posted',
  });
}

function fakeConnector(source, batchFor) {
  const calls = [];
  return {
    source,
    calls,
    async pull(period) {
      calls.push(period);
      return batchFor(period, calls.length - 1);
    },
  };
}

const NOW1 = '2026-08-01T12:00:00.000Z';
const NOW2 = '2026-08-02T12:00:00.000Z';

describe('incrementalSync window and cursor', () => {
  test('first run uses a lookback window; the watermark advances to now', async () => {
    const store = createStore();
    const acct = { account_id: 'acc-1', source: 'tochka', opening_balance: 0, currency: 'RUB', updated_at: NOW1 };
    const txns = [bankTx('acc-1', 'op-1', 'in', 500000, NOW1)];
    const connector = fakeConnector('tochka', () => ({ accounts: [acct], statements: [], transactions: txns }));

    const result = await incrementalSync({ store, sources: [{ connector }], now: NOW1, lookback_days: 30 });

    expect(connector.calls[0].from).toBe(isoMinusDays(NOW1, 30));
    expect(connector.calls[0].to).toBe(NOW1);
    expect(result.sources[0]).toMatchObject({ source: 'tochka', ok: true });
    expect(result.sources[0].persisted.inserted).toBe(1);

    const watermark = await store.getSyncState('tochka', WATERMARK_ACCOUNT);
    expect(watermark.cursor).toBe(NOW1);
    const acctState = await store.getSyncState('tochka', 'acc-1');
    expect(acctState.cursor).toBe(NOW1);
    expect(result.position.totals.RUB).toBe(500000);
  });

  test('second run pulls incrementally from the prior watermark and does not double-count', async () => {
    const store = createStore();
    const acct = { account_id: 'acc-1', source: 'tochka', opening_balance: 0, currency: 'RUB', updated_at: NOW1 };
    const txns = [bankTx('acc-1', 'op-1', 'in', 500000, NOW1)];
    const connector = fakeConnector('tochka', () => ({ accounts: [acct], statements: [], transactions: txns }));

    await incrementalSync({ store, sources: [{ connector }], now: NOW1, lookback_days: 30 });
    const countAfterFirst = (await store.listTransactions()).length;

    const second = await incrementalSync({ store, sources: [{ connector }], now: NOW2, lookback_days: 30 });

    expect(connector.calls[1].from).toBe(NOW1);
    expect(connector.calls[1].to).toBe(NOW2);
    expect(second.sources[0].persisted.inserted).toBe(0);
    expect((await store.listTransactions()).length).toBe(countAfterFirst);
    expect((await store.getSyncState('tochka', WATERMARK_ACCOUNT)).cursor).toBe(NOW2);
    expect(second.position.totals.RUB).toBe(500000);
  });

  test('a failing pull leaves the watermark unmoved so the window is retried', async () => {
    const store = createStore();
    const connector = {
      source: 'tochka',
      async pull() {
        throw new Error('sandbox down');
      },
    };

    const result = await incrementalSync({ store, sources: [{ connector }], now: NOW1 });

    expect(result.sources[0]).toMatchObject({ source: 'tochka', ok: false, error: 'sandbox down' });
    expect(await store.getSyncState('tochka', WATERMARK_ACCOUNT)).toBeNull();
  });

  test('a persistence failure does not advance the cursor and isolates the source', async () => {
    const backend = createMemoryBackend();
    const store = createStore({ backend });
    const realPut = backend.put;
    backend.put = async (table, pk, row) => {
      if (table === 'transactions') throw new Error('ydb write failed');
      return realPut(table, pk, row);
    };

    const acct = { account_id: 'acc-1', source: 'tochka', opening_balance: 0, currency: 'RUB' };
    const txns = [bankTx('acc-1', 'op-1', 'in', 500000, NOW1)];
    const connector = fakeConnector('tochka', () => ({ accounts: [acct], statements: [], transactions: txns }));

    const result = await incrementalSync({ store, sources: [{ connector }], now: NOW1 });

    expect(result.sources[0].ok).toBe(false);
    expect(await store.getSyncState('tochka', WATERMARK_ACCOUNT)).toBeNull();
  });
});

describe('incrementalSync recompute and alerts', () => {
  test('recomputes position and forecast, and produces alerts when unlocked', async () => {
    const store = createStore();
    const acct = { account_id: 'acc-1', source: 'tochka', opening_balance: 0, currency: 'RUB', updated_at: NOW1 };
    const txns = [bankTx('acc-1', 'op-1', 'in', 5000, NOW1)];
    const connector = fakeConnector('tochka', () => ({ accounts: [acct], statements: [], transactions: txns }));

    const result = await incrementalSync({
      store,
      sources: [{ connector }],
      now: NOW1,
      thresholds: { low_balance_minor: 100000 },
    });

    expect(result.forecast.current_position.amount).toBe(5000);
    expect(Array.isArray(result.alerts)).toBe(true);
    expect(result.alerts.map((a) => a.type)).toContain('low_balance');
  });

  test('a negative recomputed position surfaces a cash_gap alert from the forecast', async () => {
    const store = createStore();
    const acct = { account_id: 'acc-1', source: 'tochka', opening_balance: 0, currency: 'RUB', updated_at: NOW1 };
    const txns = [bankTx('acc-1', 'op-1', 'out', 5000, NOW1)];
    const connector = fakeConnector('tochka', () => ({ accounts: [acct], statements: [], transactions: txns }));

    const result = await incrementalSync({ store, sources: [{ connector }], now: NOW1 });

    expect(result.position.totals.RUB).toBe(-5000);
    expect(result.forecast.gap.will_occur).toBe(true);
    expect(result.alerts.map((a) => a.type)).toEqual(expect.arrayContaining(['negative_balance', 'cash_gap']));
  });

  test('alerts are gated off when the alerts module is locked', async () => {
    const store = createStore();
    const acct = { account_id: 'acc-1', source: 'tochka', opening_balance: 0, currency: 'RUB', updated_at: NOW1 };
    const txns = [bankTx('acc-1', 'op-1', 'out', 5000, NOW1)];
    const connector = fakeConnector('tochka', () => ({ accounts: [acct], statements: [], transactions: txns }));

    const result = await incrementalSync({ store, sources: [{ connector }], now: NOW1, unlockedModules: ['reconcile'] });

    expect(result.alerts).toBeNull();
  });
});
