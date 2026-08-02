'use strict';

const {
  createMoyskladConnector,
  normalizeTransaction,
  toKopecks,
  normalizeMoment,
  SOURCE,
} = require('../src/connectors/moysklad');
const { normalizeTransaction: normalizeBank } = require('../src/connectors/tochka');
const { computeId } = require('../src/model');
const { createStore } = require('../src/ydb');
const { createPremiumHandlers } = require('../src/handlers');
const { handleRequest } = require('../src/mcp');

const PAYMENT_IN = {
  id: 'ms-in-1',
  name: 'DOC-1',
  moment: '2026-07-10 12:00:00.000',
  sum: 100000,
  paymentPurpose: 'Оплата по счёту 42',
  vatSum: 16667,
  agent: { name: 'ООО Ромашка', inn: '7701234567', kpp: '770101001' },
  agentAccount: { accountNumber: '40702810900000000042', bic: '044525225' },
  organizationAccount: { accountNumber: '40802810000000000001' },
};

const PAYMENT_OUT = {
  id: 'ms-out-1',
  name: 'DOC-2',
  moment: '2026-07-12 09:30:00.000',
  sum: 25075,
  paymentPurpose: 'Аренда офиса',
  agent: { name: 'ИП Иванов', inn: '500100732259' },
};

const SANDBOX = {
  paymentin: { rows: [PAYMENT_IN] },
  paymentout: { rows: [PAYMENT_OUT] },
};

function fakeHttp(calls) {
  return async (url, init) => {
    const method = (init && init.method) || 'GET';
    calls.push(`${method} ${url}`);
    let body = { rows: [] };
    if (url.includes('/entity/paymentin')) body = SANDBOX.paymentin;
    else if (url.includes('/entity/paymentout')) body = SANDBOX.paymentout;
    return {
      ok: true,
      status: 200,
      async json() {
        return body;
      },
      async text() {
        return '';
      },
    };
  };
}

describe('toKopecks / normalizeMoment', () => {
  test('sum is already minor units, coerced to a non-negative integer', () => {
    expect(toKopecks(100000)).toBe(100000);
    expect(toKopecks('25075')).toBe(25075);
    expect(toKopecks(-500)).toBe(500);
    expect(toKopecks(null)).toBe(0);
  });

  test('moment becomes an ISO-like timestamp', () => {
    expect(normalizeMoment('2026-07-10 12:00:00.000')).toBe('2026-07-10T12:00:00.000');
    expect(normalizeMoment('2026-07-10')).toBe('2026-07-10');
    expect(normalizeMoment('')).toBe('');
  });
});

describe('normalizeTransaction', () => {
  test('incoming payment becomes an incoming ledger entry', () => {
    const tx = normalizeTransaction(PAYMENT_IN, { type: 'paymentin' });
    expect(tx.id).toBe(computeId(SOURCE, '40802810000000000001', 'ms-in-1'));
    expect(tx.source).toBe(SOURCE);
    expect(tx.kind).toBe('ledger');
    expect(tx.direction).toBe('in');
    expect(tx.status).toBe('posted');
    expect(tx.amount).toBe(100000);
    expect(tx.currency).toBe('RUB');
    expect(tx.purpose).toBe('Оплата по счёту 42');
    expect(tx.doc_number).toBe('DOC-1');
    expect(tx.vat_amount).toBe(16667);
    expect(tx.counterparty).toEqual({
      name: 'ООО Ромашка',
      inn: '7701234567',
      kpp: '770101001',
      account: '40702810900000000042',
      bic: '044525225',
    });
    expect(tx.raw).toBe(PAYMENT_IN);
  });

  test('outgoing payment becomes an outgoing ledger entry and falls back to ledger account', () => {
    const tx = normalizeTransaction(PAYMENT_OUT, { type: 'paymentout' });
    expect(tx.direction).toBe('out');
    expect(tx.amount).toBe(25075);
    expect(tx.account_id).toBe('ledger');
    expect(tx.counterparty).toEqual({ name: 'ИП Иванов', inn: '500100732259' });
  });
});

describe('connector.pull', () => {
  test('pulls both document types and normalizes into ledger transactions', async () => {
    const calls = [];
    const connector = createMoyskladConnector({
      token: 'ms.token',
      http: fakeHttp(calls),
    });

    const result = await connector.pull({ from: '2026-07-01 00:00:00', to: '2026-07-31 23:59:59' });

    expect(result.accounts).toEqual([]);
    expect(result.statements).toEqual([]);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions.every((t) => t.kind === 'ledger')).toBe(true);
    expect(result.transactions.map((t) => t.direction)).toEqual(['in', 'out']);

    expect(calls.some((c) => c.includes('/entity/paymentin?expand='))).toBe(true);
    expect(calls.some((c) => c.includes('/entity/paymentout?expand='))).toBe(true);
    expect(calls.some((c) => c.includes('filter='))).toBe(true);
  });

  test('ISO period bounds are rewritten to MoySklad moment format in the filter', async () => {
    const calls = [];
    const connector = createMoyskladConnector({ token: 'ms.token', http: fakeHttp(calls) });

    await connector.pull({ from: '2026-07-01T00:00:00.000Z', to: '2026-07-31T23:59:59.000Z' });

    const filtered = calls.find((c) => c.includes('filter='));
    const decoded = decodeURIComponent(filtered);
    expect(decoded).toContain('moment>=2026-07-01 00:00:00');
    expect(decoded).toContain('moment<=2026-07-31 23:59:59');
    expect(decoded).not.toContain('moment>=2026-07-01T');
    expect(decoded).not.toContain('Z;');
  });

  test('requires a token', async () => {
    const connector = createMoyskladConnector({ http: async () => ({ ok: true, json: async () => ({}) }) });
    await expect(connector.listDocuments('paymentin')).rejects.toThrow(/token required/);
  });

  test('non-ok responses raise a descriptive error', async () => {
    const connector = createMoyskladConnector({
      token: 't',
      http: async () => ({ ok: false, status: 412, async text() { return 'precondition'; } }),
    });
    await expect(connector.listDocuments('paymentin')).rejects.toThrow(/412 precondition/);
  });
});

describe('reconcile tool wired to bank(tochka) <-> ledger(moysklad)', () => {
  function bankTxn(over) {
    return normalizeBank(
      {
        transactionId: over.transactionId,
        creditDebitIndicator: over.creditDebitIndicator || 'Credit',
        status: 'Booked',
        amount: { amount: over.amount, currency: 'RUB' },
        bookingDateTime: over.date,
        transactionInformation: over.purpose,
        documentProductNumber: over.doc,
        DebtorParty: over.inn ? { name: over.name, inn: over.inn } : undefined,
        CreditorParty: over.creditorInn ? { name: over.name, inn: over.creditorInn } : undefined,
      },
      { accountId: '40802810000000000001' }
    );
  }

  function ledgerTxn(type, over) {
    return normalizeTransaction(
      {
        id: over.id,
        name: over.doc,
        moment: over.date,
        sum: over.sum,
        paymentPurpose: over.purpose,
        agent: over.inn ? { name: over.name, inn: over.inn } : undefined,
      },
      { type }
    );
  }

  async function seededStore() {
    const store = createStore();
    const bank = [
      bankTxn({ transactionId: 'b1', amount: '1000.00', date: '2026-07-10', doc: 'DOC-1', purpose: 'Счёт 42', name: 'ООО Ромашка', inn: '7701234567' }),
      bankTxn({ transactionId: 'b2', amount: '1000.00', date: '2026-07-15', doc: 'DOC-5', purpose: 'Счёт 99', name: 'ООО Лютик', inn: '7709999999' }),
    ];
    const ledger = [
      ledgerTxn('paymentin', { id: 'l1', doc: 'DOC-1', date: '2026-07-10', sum: 100000, purpose: 'Счёт 42', name: 'ООО Ромашка', inn: '7701234567' }),
      ledgerTxn('paymentin', { id: 'l2', doc: 'DOC-7', date: '2026-07-20', sum: 50000, purpose: 'Счёт 77', name: 'ООО Пион', inn: '7708888888' }),
    ];
    await store.putTransactions([...bank, ...ledger]);
    return store;
  }

  const rpc = (args, ctx) =>
    handleRequest(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'reconcile', arguments: args } },
      ctx
    );

  test('matches shared docs and reports typed exceptions for the rest', async () => {
    const store = await seededStore();
    const handlers = createPremiumHandlers(store);
    const res = await rpc(
      {
        period: { from: '2026-07-01', to: '2026-07-31' },
        bank_source: 'tochka',
        ledger_source: 'moysklad',
      },
      { handlers, store }
    );

    const out = res.result;
    expect(out.summary.matched).toBe(1);
    expect(out.summary.matched_amount).toBe(100000);
    expect(out.matched[0].match_type).toBe('exact');

    const types = out.exceptions.map((e) => e.type).sort();
    expect(types).toEqual(['missing_in_bank', 'missing_in_ledger']);
    expect(out.exceptions.find((e) => e.type === 'missing_in_ledger').bank_txn_id).toBe(
      bankTxn({ transactionId: 'b2', amount: '1000.00', date: '2026-07-15', doc: 'DOC-5' }).id
    );
  });

  test('persists a reconcile run', async () => {
    const store = await seededStore();
    const handlers = createPremiumHandlers(store);
    await rpc(
      { period: { from: '2026-07-01', to: '2026-07-31' }, bank_source: 'tochka', ledger_source: 'moysklad' },
      { handlers, store }
    );
    const runs = await store.listReconcileRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].summary.matched).toBe(1);
  });

  test('the period window bounds which transactions are reconciled', async () => {
    const store = await seededStore();
    const handlers = createPremiumHandlers(store);
    const res = await rpc(
      { period: { from: '2026-07-01', to: '2026-07-12' }, bank_source: 'tochka', ledger_source: 'moysklad' },
      { handlers, store }
    );
    expect(res.result.summary.matched).toBe(1);
    expect(res.result.exceptions.every((e) => e.type !== 'missing_in_bank')).toBe(true);
  });
});
