'use strict';

const { generateCase } = require('../src/synthetic');
const { makeTransaction, signedAmount } = require('../src/model');
const {
  computeCashPosition,
  reconcile,
  checkPayment,
  daysBetween,
} = require('../src/reconcile');

describe('reconcile against synthetic ground truth', () => {
  const c = generateCase({ seed: 11 });
  const result = reconcile({
    bank: c.bank.transactions,
    ledger: c.ledger.transactions,
  });

  const found = (type) => result.exceptions.filter((e) => e.type === type);
  const expected = (type) => c.expected.exceptions.filter((e) => e.type === type);

  test('summary equals the fixture summary exactly', () => {
    expect(result.summary).toEqual(c.expected.summary);
  });

  test('recovers every matched pair the fixture declares', () => {
    expect(result.matched).toHaveLength(c.expected.matched.length);
    for (const m of c.expected.matched) {
      const hit = result.matched.find(
        (r) => r.bank_txn_id === m.bank_txn_id && r.ledger_entry_id === m.ledger_entry_id
      );
      expect(hit).toBeDefined();
      expect(hit.amount).toBe(m.amount);
      expect(hit.match_type).toBe('exact');
    }
  });

  test('emits exactly the six discrepancy types the fixture carries', () => {
    const types = new Set(result.exceptions.map((e) => e.type));
    expect(types).toEqual(
      new Set([
        'missing_in_ledger',
        'missing_in_bank',
        'amount_mismatch',
        'partial_payment',
        'duplicate',
        'purpose_ambiguous',
      ])
    );
  });

  test('missing_in_ledger points at the fixture bank line', () => {
    expect(found('missing_in_ledger').map((e) => e.bank_txn_id).sort()).toEqual(
      expected('missing_in_ledger').map((e) => e.bank_txn_id).sort()
    );
  });

  test('missing_in_bank points at the fixture ledger entry', () => {
    expect(found('missing_in_bank').map((e) => e.ledger_entry_id).sort()).toEqual(
      expected('missing_in_bank').map((e) => e.ledger_entry_id).sort()
    );
  });

  test('amount_mismatch delta matches (bank − ledger)', () => {
    const got = found('amount_mismatch')[0];
    const exp = expected('amount_mismatch')[0];
    expect(got.bank_txn_id).toBe(exp.bank_txn_id);
    expect(got.ledger_entry_id).toBe(exp.ledger_entry_id);
    expect(got.delta).toBe(exp.delta);
  });

  test('partial_payment delta matches (ledger − bank) and carries a suggestion', () => {
    const got = found('partial_payment')[0];
    const exp = expected('partial_payment')[0];
    expect(got.bank_txn_id).toBe(exp.bank_txn_id);
    expect(got.ledger_entry_id).toBe(exp.ledger_entry_id);
    expect(got.delta).toBe(exp.delta);
    expect(got.suggestion).toMatch(/partial/i);
  });

  test('duplicate references the replayed bank line by dedup_key', () => {
    const got = found('duplicate')[0];
    const exp = expected('duplicate')[0];
    expect(got.dedup_key).toBe(exp.dedup_key);
    expect(got.bank_txn_id).toBe(exp.bank_txn_id);
  });

  test('purpose_ambiguous lists both candidate bank lines for one ledger entry', () => {
    const got = found('purpose_ambiguous')[0];
    const exp = expected('purpose_ambiguous')[0];
    expect(got.ledger_entry_id).toBe(exp.ledger_entry_id);
    expect(new Set(got.bank_txn_ids)).toEqual(new Set(exp.bank_txn_ids));
  });
});

describe('reconcile tolerance', () => {
  test('amounts within tolerance become a tolerance match, not a mismatch', () => {
    const c = generateCase({
      seed: 4,
      specs: [{ type: 'amount_mismatch', amount: 3000000, ledgerAmount: 2990000, direction: 'out' }],
    });
    const strict = reconcile({ bank: c.bank.transactions, ledger: c.ledger.transactions });
    expect(strict.summary.matched).toBe(0);
    expect(strict.exceptions.filter((e) => e.type === 'amount_mismatch')).toHaveLength(1);

    const tolerant = reconcile({
      bank: c.bank.transactions,
      ledger: c.ledger.transactions,
      tolerance: { amount_minor: 10000, days: 0 },
    });
    expect(tolerant.summary.matched).toBe(1);
    expect(tolerant.matched[0].match_type).toBe('tolerance');
    expect(tolerant.exceptions).toHaveLength(0);
  });
});

describe('reconcile groups by stable reference, never by amount', () => {
  const cp = { name: 'OOO Postavshik', inn: '7701234567' };
  const base = {
    source: 'tochka',
    account_id: 'acc-1',
    currency: 'RUB',
    booked_at: '2026-07-02T00:00:00.000Z',
    counterparty: cp,
    purpose: 'Oplata za uslugi',
    status: 'posted',
  };

  test('amount_mismatch pairs group by inn when doc_number/uin are absent', () => {
    const bank = makeTransaction({ ...base, kind: 'bank', direction: 'out', amount: 3000000, native_id: 'b-1' });
    const ledger = makeTransaction({ ...base, kind: 'ledger', direction: 'out', amount: 2990000, native_id: 'l-1' });
    const res = reconcile({ bank: [bank], ledger: [ledger] });
    expect(res.exceptions.filter((e) => e.type === 'missing_in_ledger')).toHaveLength(0);
    expect(res.exceptions.filter((e) => e.type === 'missing_in_bank')).toHaveLength(0);
    const mm = res.exceptions.filter((e) => e.type === 'amount_mismatch');
    expect(mm).toHaveLength(1);
    expect(mm[0].delta).toBe(10000);
  });

  test('partial_payment pairs group by purpose when no inn/doc_number/uin', () => {
    const noInn = { ...base, counterparty: { name: 'OOO Bez INN' } };
    const bank = makeTransaction({ ...noInn, kind: 'bank', direction: 'in', amount: 3000000, native_id: 'b-2' });
    const ledger = makeTransaction({ ...noInn, kind: 'ledger', direction: 'in', amount: 5000000, native_id: 'l-2' });
    const res = reconcile({ bank: [bank], ledger: [ledger] });
    expect(res.exceptions.filter((e) => e.type === 'missing_in_ledger')).toHaveLength(0);
    expect(res.exceptions.filter((e) => e.type === 'missing_in_bank')).toHaveLength(0);
    const pp = res.exceptions.filter((e) => e.type === 'partial_payment');
    expect(pp).toHaveLength(1);
    expect(pp[0].delta).toBe(2000000);
  });
});

describe('computeCashPosition', () => {
  test('sums closing balances across accounts and reports per-account staleness', () => {
    const c = generateCase({ seed: 2 });
    const other = generateCase({ seed: 9, accountId: 'acc-40702810000000000002', openingBalance: 5000000 });

    const pos = computeCashPosition({
      as_of: '2026-03-01T00:00:00.000Z',
      accounts: [
        {
          account_id: c.bank.statement.account_id,
          source: 'tochka',
          closing_balance: c.bank.statement.closing_balance,
          updated_at: '2026-02-28T00:00:00.000Z',
        },
        {
          account_id: other.bank.statement.account_id,
          source: 'tochka',
          closing_balance: other.bank.statement.closing_balance,
          updated_at: '2026-02-01T00:00:00.000Z',
        },
      ],
    });

    expect(pos.total.currency).toBe('RUB');
    expect(pos.total.amount).toBe(
      c.bank.statement.closing_balance + other.bank.statement.closing_balance
    );
    expect(pos.by_account).toHaveLength(2);
    expect(pos.by_account[0].staleness_sec).toBe(86400); // one day
    expect(pos.by_account[1].bank).toBe('tochka');
  });

  test('derives balance from posted lines and warns on pending', () => {
    const opening = 1000000;
    const posted = makeTransaction({
      source: 'tochka',
      kind: 'bank',
      account_id: 'acc-1',
      direction: 'in',
      amount: 500000,
      booked_at: '2026-01-02T00:00:00.000Z',
      native_id: 'p1',
      status: 'posted',
    });
    const pending = makeTransaction({
      source: 'tochka',
      kind: 'bank',
      account_id: 'acc-1',
      direction: 'in',
      amount: 999999,
      booked_at: '2026-01-03T00:00:00.000Z',
      native_id: 'p2',
      status: 'pending',
    });

    const pos = computeCashPosition({
      accounts: [
        {
          account_id: 'acc-1',
          source: 'tochka',
          opening_balance: opening,
          transactions: [posted, pending],
          updated_at: '2026-01-03T00:00:00.000Z',
        },
      ],
    });

    // Pending excluded from the cleared balance.
    expect(pos.by_account[0].amount).toBe(opening + signedAmount(posted));
    expect(pos.warnings.some((w) => /pending/.test(w))).toBe(true);
  });

  test('excludes foreign-currency accounts from the total and warns', () => {
    const pos = computeCashPosition({
      currency: 'RUB',
      as_of: '2026-01-01T00:00:00.000Z',
      accounts: [
        { account_id: 'r', source: 'tochka', closing_balance: 100, currency: 'RUB' },
        { account_id: 'u', source: 'tochka', closing_balance: 200, currency: 'USD' },
      ],
    });
    expect(pos.total.amount).toBe(100);
    expect(pos.warnings.some((w) => /USD/.test(w))).toBe(true);
  });
});

describe('checkPayment', () => {
  const c = generateCase({ seed: 6 });
  const bankTxns = c.bank.transactions;

  test('found: a cleared bank line matched by doc_number + amount', () => {
    const target = bankTxns[0];
    const res = checkPayment(bankTxns, {
      doc_number: target.doc_number,
      amount: target.amount,
    });
    expect(res.status).toBe('found');
    expect(res.matches[0].transaction.id).toBe(target.id);
    expect(res.matches[0].confidence).toBeGreaterThanOrEqual(0.5);
    expect(res.explanation).toMatch(/found/i);
  });

  test('pending: matching line exists but has not cleared', () => {
    const pending = makeTransaction({
      source: 'tochka',
      kind: 'bank',
      account_id: 'acc-1',
      direction: 'out',
      amount: 250000,
      booked_at: '2026-01-05T00:00:00.000Z',
      counterparty: { name: 'OOO X', inn: '7712345678' },
      doc_number: 'PAY-9',
      native_id: 'pend-1',
      status: 'pending',
    });
    const res = checkPayment([pending], { doc_number: 'PAY-9', amount: 250000 });
    expect(res.status).toBe('pending');
    expect(res.explanation).toMatch(/pending/i);
  });

  test('not_found: no line matches the criteria', () => {
    const res = checkPayment(bankTxns, {
      doc_number: 'DOES-NOT-EXIST',
      amount: 123,
    });
    expect(res.status).toBe('not_found');
    expect(res.matches).toHaveLength(0);
  });

  test('confidence rises with more matching identity fields', () => {
    const target = bankTxns.find((tx) => tx.counterparty && tx.counterparty.inn);
    const weak = checkPayment(bankTxns, { amount: target.amount });
    const strong = checkPayment(bankTxns, {
      amount: target.amount,
      doc_number: target.doc_number,
      counterparty_inn: target.counterparty.inn,
    });
    const weakTop = weak.matches.find((m) => m.transaction.id === target.id);
    const strongTop = strong.matches.find((m) => m.transaction.id === target.id);
    expect(strongTop.confidence).toBeGreaterThan(weakTop.confidence);
  });

  test('purpose_contains matching is case-insensitive and honors the date window', () => {
    const target = bankTxns[1];
    const res = checkPayment(bankTxns, {
      purpose_contains: target.purpose.slice(0, 6).toUpperCase(),
      doc_number: target.doc_number,
      date_from: '2026-01-01',
      date_to: '2026-12-31',
    });
    expect(res.status).toBe('found');
    expect(res.matches[0].transaction.id).toBe(target.id);
  });
});

describe('daysBetween helper', () => {
  test('whole-day distance, order-independent', () => {
    expect(daysBetween('2026-01-01T00:00:00Z', '2026-01-04T00:00:00Z')).toBe(3);
    expect(daysBetween('2026-01-04T00:00:00Z', '2026-01-01T00:00:00Z')).toBe(3);
    expect(daysBetween('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')).toBe(0);
  });
});
