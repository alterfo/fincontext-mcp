'use strict';

const { createStore } = require('../src/ydb');
const { createOpenHandlers, syncSource } = require('../src/handlers');
const { handleRequest } = require('../src/mcp');
const { normalizeTransaction, normalizeAccount } = require('../src/connectors/tochka');

const ACCOUNT_ID = '40802810000000000001';

function fakeConnector() {
  const account = normalizeAccount({
    accountId: ACCOUNT_ID,
    currency: 'RUB',
    servicer: { bankId: '044525104' },
  });
  account.closing_balance = 150050;
  account.updated_at = '2026-08-01T09:00:00Z';

  const rawTxns = [
    {
      transactionId: 't1',
      creditDebitIndicator: 'Credit',
      status: 'Booked',
      amount: { amount: '1000.00', currency: 'RUB' },
      bookingDateTime: '2026-07-10T12:00:00Z',
      transactionInformation: 'Оплата по счёту 42',
      documentProductNumber: 'DOC-1',
      DebtorParty: { name: 'ООО Ромашка', inn: '7701234567' },
    },
    {
      transactionId: 't3',
      creditDebitIndicator: 'Credit',
      status: 'Pending',
      amount: { amount: '500.00', currency: 'RUB' },
      bookingDateTime: '2026-07-31T18:00:00Z',
      transactionInformation: 'Предоплата',
      documentProductNumber: 'DOC-3',
    },
  ];
  const transactions = rawTxns.map((t) => normalizeTransaction(t, { accountId: ACCOUNT_ID }));

  return {
    source: 'tochka',
    async pull() {
      return {
        accounts: [account],
        statements: [
          {
            account_id: ACCOUNT_ID,
            source: 'tochka',
            period_from: '2026-07-02T00:00:00Z',
            period_to: '2026-08-01T00:00:00Z',
            opening_balance: 100000,
            closing_balance: 150050,
            fetched_at: '2026-08-01T09:00:00Z',
            line_ids: transactions.map((t) => t.id),
          },
        ],
        transactions,
      };
    },
  };
}

async function seededStore() {
  const store = createStore();
  await syncSource(store, fakeConnector(), {
    from: '2026-07-02T00:00:00Z',
    to: '2026-08-01T00:00:00Z',
    as_of: '2026-08-01T09:00:00Z',
  });
  return store;
}

const rpc = (name, args, ctx) =>
  handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx);

describe('syncSource idempotency', () => {
  test('re-running the sync does not double-count transactions', async () => {
    const store = createStore();
    const first = await syncSource(store, fakeConnector(), { from: '2026-07-02', to: '2026-08-01' });
    expect(first.persisted.inserted).toBe(2);
    const second = await syncSource(store, fakeConnector(), { from: '2026-07-02', to: '2026-08-01' });
    expect(second.persisted.inserted).toBe(0);
    expect(second.persisted.replaced).toBe(2);
    const all = await store.listTransactions({});
    expect(all).toHaveLength(2);
  });
});

describe('get_cash_position wired to cached connector data', () => {
  test('reports the closing balance with honesty fields', async () => {
    const store = await seededStore();
    const handlers = createOpenHandlers(store);
    const res = await rpc(
      'get_cash_position',
      { as_of: '2026-08-01T10:00:00Z', currency: 'RUB' },
      { handlers, store }
    );

    const out = res.result;
    expect(out.total).toEqual({ amount: 150050, currency: 'RUB' });
    expect(out.by_account).toHaveLength(1);

    const acct = out.by_account[0];
    expect(acct.account_id).toBe(ACCOUNT_ID);
    expect(acct.bank).toBe('tochka');
    expect(acct.amount).toBe(150050);
    expect(acct.staleness_sec).toBe(3600);

    expect(out.warnings.some((w) => w.includes('pending'))).toBe(true);
  });

  test('accounts filter narrows the report', async () => {
    const store = await seededStore();
    const handlers = createOpenHandlers(store);
    const res = await rpc('get_cash_position', { accounts: ['does-not-exist'] }, { handlers, store });
    expect(res.result.by_account).toHaveLength(0);
    expect(res.result.total.amount).toBe(0);
  });
});

describe('check_payment wired to cached connector data', () => {
  test('finds a cleared payment by amount and counterparty INN', async () => {
    const store = await seededStore();
    const handlers = createOpenHandlers(store);
    const res = await rpc(
      'check_payment',
      { amount: 100000, counterparty_inn: '7701234567' },
      { handlers, store }
    );
    expect(res.result.status).toBe('found');
    expect(res.result.matches[0].transaction.doc_number).toBe('DOC-1');
  });

  test('a matching but pending payment reports pending, not found', async () => {
    const store = await seededStore();
    const handlers = createOpenHandlers(store);
    const res = await rpc('check_payment', { doc_number: 'DOC-3' }, { handlers, store });
    expect(res.result.status).toBe('pending');
  });

  test('no match reports not_found', async () => {
    const store = await seededStore();
    const handlers = createOpenHandlers(store);
    const res = await rpc('check_payment', { doc_number: 'NOPE-9' }, { handlers, store });
    expect(res.result.status).toBe('not_found');
  });
});
