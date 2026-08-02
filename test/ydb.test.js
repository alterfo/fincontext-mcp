'use strict';

const { generateCase } = require('../src/synthetic');
const { makeTransaction, signedAmount } = require('../src/model');
const { createStore, createMemoryBackend, accountBalance } = require('../src/ydb');

describe('idempotent transaction persistence', () => {
  test('re-running the same batch does not double-count', async () => {
    const store = createStore();
    const c = generateCase({ seed: 3 });
    const txns = c.bank.transactions;

    const first = await store.putTransactions(txns);
    // The synthetic case carries one duplicate line (identical native id -> same id),
    // which PUT-by-id collapses on first insert already.
    const stored1 = await store.listTransactions();

    const second = await store.putTransactions(txns);
    const stored2 = await store.listTransactions();

    // A full replay adds zero rows.
    expect(stored2).toHaveLength(stored1.length);
    // Every line on the second pass is an idempotent replace, never a new insert.
    expect(second.inserted).toBe(0);
    expect(second.replaced + second.duplicates).toBe(txns.length);
    // First pass inserted every distinct id exactly once.
    expect(first.inserted).toBeGreaterThan(0);
  });

  test('a different id with an already-seen dedup_key is reported as duplicate and not stored', async () => {
    const store = createStore();
    // No native_id -> id derives from (source, account_id, null) and dedup_key from content.
    const base = {
      source: 'tochka',
      kind: 'bank',
      account_id: 'acc-x',
      direction: 'out',
      amount: 123400,
      booked_at: '2026-01-05T00:00:00.000Z',
      doc_number: 'DOC-1',
      purpose: 'test',
    };
    const a = makeTransaction(base);
    const b = makeTransaction({ ...base, id: 'forced-different-id' });
    expect(a.dedup_key).toBe(b.dedup_key);
    expect(a.id).not.toBe(b.id);

    expect(await store.putTransaction(a)).toBe('inserted');
    expect(await store.putTransaction(b)).toBe('duplicate');
    expect(await store.listTransactions()).toHaveLength(1);
  });

  test('putTransaction upserts the row on replay (same id)', async () => {
    const store = createStore();
    const tx = makeTransaction({
      source: 'tochka',
      kind: 'bank',
      account_id: 'acc-1',
      direction: 'in',
      amount: 5000,
      booked_at: '2026-02-01T00:00:00.000Z',
      native_id: 'op-1',
      status: 'pending',
    });
    expect(await store.putTransaction(tx)).toBe('inserted');
    const cleared = makeTransaction({ ...tx, native_id: 'op-1', status: 'posted' });
    expect(await store.putTransaction(cleared)).toBe('replaced');
    const got = await store.getTransaction(tx.id);
    expect(got.status).toBe('posted');
    expect(await store.listTransactions()).toHaveLength(1);
  });
});

describe('sync_state cursor advances only after persistence', () => {
  test('syncBatch persists then advances; replay keeps the count stable', async () => {
    const store = createStore();
    const c = generateCase({ seed: 8 });
    const txns = c.ledger.transactions;

    const r1 = await store.syncBatch({
      source: 'moysklad',
      account_id: c.ledger.statement.account_id,
      transactions: txns,
      cursor: '2026-01-31T00:00:00.000Z',
      updated_at: '2026-02-01T00:00:00.000Z',
    });
    expect(r1.cursor).toBe('2026-01-31T00:00:00.000Z');
    const state = await store.getSyncState('moysklad', c.ledger.statement.account_id);
    expect(state.cursor).toBe('2026-01-31T00:00:00.000Z');
    const count1 = (await store.listTransactions()).length;

    // Replay the same window with an advanced cursor: no duplication, cursor moves.
    const r2 = await store.syncBatch({
      source: 'moysklad',
      account_id: c.ledger.statement.account_id,
      transactions: txns,
      cursor: '2026-02-28T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
    });
    expect(r2.persisted.inserted).toBe(0);
    expect((await store.listTransactions()).length).toBe(count1);
    expect((await store.getSyncState('moysklad', c.ledger.statement.account_id)).cursor).toBe(
      '2026-02-28T00:00:00.000Z'
    );
  });

  test('cursor is NOT advanced when persistence fails', async () => {
    const backend = createMemoryBackend();
    const store = createStore({ backend });
    // Force a persistence failure on the transactions table only.
    const realPut = backend.put;
    backend.put = async (table, pk, row) => {
      if (table === 'transactions') throw new Error('boom');
      return realPut(table, pk, row);
    };
    const tx = makeTransaction({
      source: 'tochka',
      kind: 'bank',
      account_id: 'acc-9',
      direction: 'out',
      amount: 100,
      booked_at: '2026-01-01T00:00:00.000Z',
      native_id: 'z1',
    });
    await expect(
      store.syncBatch({ source: 'tochka', account_id: 'acc-9', transactions: [tx], cursor: 'c1' })
    ).rejects.toThrow('boom');
    expect(await store.getSyncState('tochka', 'acc-9')).toBeNull();
  });
});

describe('accountBalance helper', () => {
  test('prefers the latest statement closing balance', () => {
    const account = { account_id: 'a', source: 'tochka', opening_balance: 1000, currency: 'RUB' };
    const statements = [
      { account_id: 'a', source: 'tochka', period_to: '2026-01-31', closing_balance: 7777 },
      { account_id: 'a', source: 'tochka', period_to: '2026-02-28', closing_balance: 9999 },
    ];
    expect(accountBalance(account, statements, [])).toBe(9999);
  });

  test('falls back to opening + posted lines, ignoring pending', () => {
    const account = { account_id: 'a', source: 'tochka', opening_balance: 1000, currency: 'RUB' };
    const posted = makeTransaction({
      source: 'tochka', kind: 'bank', account_id: 'a', direction: 'in', amount: 500,
      booked_at: '2026-01-02T00:00:00.000Z', native_id: 'p1', status: 'posted',
    });
    const pending = makeTransaction({
      source: 'tochka', kind: 'bank', account_id: 'a', direction: 'in', amount: 400,
      booked_at: '2026-01-03T00:00:00.000Z', native_id: 'p2', status: 'pending',
    });
    expect(accountBalance(account, [], [posted, pending])).toBe(1000 + signedAmount(posted));
  });
});

describe('position materialization', () => {
  test('materializes per-account rows, an aggregate cash position, and forecast inputs', async () => {
    const store = createStore();
    const c1 = generateCase({ seed: 2 });
    const c2 = generateCase({ seed: 9, accountId: 'acc-40702810000000000002', openingBalance: 5000000 });

    await store.putAccount({
      account_id: c1.bank.statement.account_id,
      source: 'tochka',
      opening_balance: 10000000,
      updated_at: '2026-02-28T00:00:00.000Z',
    });
    await store.putAccount({
      account_id: c2.bank.statement.account_id,
      source: 'tochka',
      opening_balance: 5000000,
      updated_at: '2026-02-28T00:00:00.000Z',
    });
    await store.putStatement(c1.bank.statement);
    await store.putStatement(c2.bank.statement);
    await store.putTransactions(c1.bank.transactions);
    await store.putTransactions(c2.bank.transactions);

    const agg = await store.materializePositions({ as_of: '2026-03-01T00:00:00.000Z' });

    const expectedTotal = c1.bank.statement.closing_balance + c2.bank.statement.closing_balance;
    expect(agg.position.totals.RUB).toBe(expectedTotal);
    expect(agg.forecast_inputs.current_position).toBe(expectedTotal);
    expect(agg.forecast_inputs.by_account).toHaveLength(2);

    // Per-account row persisted and readable.
    const row = await store.getPosition(c1.bank.statement.account_id);
    expect(row.balance).toBe(c1.bank.statement.closing_balance);
    expect(row.as_of).toBe('2026-03-01T00:00:00.000Z');

    // Aggregate readable via convenience getters.
    expect((await store.getCashPosition()).totals.RUB).toBe(expectedTotal);
    expect((await store.getForecastInputs()).current_position).toBe(expectedTotal);
  });

  test('re-materializing after a replay yields the same totals (idempotent inputs)', async () => {
    const store = createStore();
    const c = generateCase({ seed: 5 });
    await store.putAccount({ account_id: c.bank.statement.account_id, source: 'tochka', opening_balance: 10000000 });
    await store.putStatement(c.bank.statement);
    await store.putTransactions(c.bank.transactions);

    const a1 = await store.materializePositions({ as_of: '2026-03-01T00:00:00.000Z' });
    // Replay the same transactions, then re-materialize.
    await store.putTransactions(c.bank.transactions);
    const a2 = await store.materializePositions({ as_of: '2026-03-01T00:00:00.000Z' });

    expect(a2.position.totals.RUB).toBe(a1.position.totals.RUB);
    expect(a2.forecast_inputs.current_position).toBe(a1.forecast_inputs.current_position);
  });
});
