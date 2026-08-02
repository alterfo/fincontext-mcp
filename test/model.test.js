'use strict';

const {
  computeId,
  computeDedupKey,
  isKopecks,
  signedAmount,
  makeTransaction,
  makeStatement,
  makeCashPosition,
} = require('../src/model');

describe('makeTransaction', () => {
  const base = {
    source: 'tochka',
    kind: 'bank',
    account_id: 'acc-1',
    direction: 'out',
    amount: 150000,
    booked_at: '2026-01-05T00:00:00.000Z',
    native_id: 'op-1',
  };

  test('builds a normalized transaction with defaults', () => {
    const tx = makeTransaction(base);
    expect(tx.currency).toBe('RUB');
    expect(tx.status).toBe('posted');
    expect(tx.id).toBe(computeId('tochka', 'acc-1', 'op-1'));
    expect(tx.dedup_key).toBe(computeDedupKey({ ...base }));
  });

  test('rejects a floating or negative amount (kopecks only, sign via direction)', () => {
    expect(() => makeTransaction({ ...base, amount: 1500.5 })).toThrow(/non-negative integer/);
    expect(() => makeTransaction({ ...base, amount: -100 })).toThrow(/non-negative integer/);
  });

  test('rejects unknown enums', () => {
    expect(() => makeTransaction({ ...base, source: 'sber' })).toThrow(/unknown source/);
    expect(() => makeTransaction({ ...base, direction: 'debit' })).toThrow(/unknown direction/);
    expect(() => makeTransaction({ ...base, kind: 'invoice' })).toThrow(/unknown kind/);
  });

  test('signedAmount carries direction', () => {
    expect(signedAmount(makeTransaction({ ...base, direction: 'in' }))).toBe(150000);
    expect(signedAmount(makeTransaction({ ...base, direction: 'out' }))).toBe(-150000);
  });
});

describe('dedup_key stability', () => {
  const base = {
    source: 'tochka',
    kind: 'bank',
    account_id: 'acc-1',
    direction: 'out',
    amount: 150000,
    booked_at: '2026-01-05T00:00:00.000Z',
  };

  test('same native_id => identical id and dedup_key across rebuilds', () => {
    const a = makeTransaction({ ...base, native_id: 'op-9' });
    const b = makeTransaction({ ...base, native_id: 'op-9' });
    expect(a.id).toBe(b.id);
    expect(a.dedup_key).toBe(b.dedup_key);
  });

  test('different native_id => different id', () => {
    const a = makeTransaction({ ...base, native_id: 'op-9' });
    const b = makeTransaction({ ...base, native_id: 'op-10' });
    expect(a.id).not.toBe(b.id);
  });

  test('no native_id => content-hash dedup key, stable and content-sensitive', () => {
    const a = makeTransaction({ ...base, doc_number: 'D-1' });
    const b = makeTransaction({ ...base, doc_number: 'D-1' });
    const c = makeTransaction({ ...base, doc_number: 'D-2' });
    expect(a.dedup_key).toBe(b.dedup_key);
    expect(a.dedup_key).not.toBe(c.dedup_key);
  });
});

describe('makeStatement completeness invariant', () => {
  const mk = (direction, amount, nativeId) =>
    makeTransaction({
      source: 'tochka',
      kind: 'bank',
      account_id: 'acc-1',
      direction,
      amount,
      booked_at: '2026-01-05T00:00:00.000Z',
      native_id: nativeId,
    });

  test('accepts a statement where opening + Σin − Σout == closing', () => {
    const lines = [mk('in', 300000, 'a'), mk('out', 100000, 'b')];
    const st = makeStatement({
      account_id: 'acc-1',
      source: 'tochka',
      opening_balance: 500000,
      closing_balance: 700000,
      lines,
    });
    expect(st.line_ids).toHaveLength(2);
    expect(st.closing_balance).toBe(700000);
  });

  test('rejects a statement that violates completeness', () => {
    const lines = [mk('in', 300000, 'a')];
    expect(() =>
      makeStatement({
        account_id: 'acc-1',
        source: 'tochka',
        opening_balance: 500000,
        closing_balance: 999999,
        lines,
      })
    ).toThrow(/not complete/);
  });

  test('allows a negative (overdrawn) closing balance', () => {
    const lines = [mk('out', 800000, 'a')];
    const st = makeStatement({
      account_id: 'acc-1',
      source: 'tochka',
      opening_balance: 500000,
      closing_balance: -300000,
      lines,
    });
    expect(st.closing_balance).toBe(-300000);
  });
});

describe('makeCashPosition', () => {
  test('aggregates per-currency totals', () => {
    const pos = makeCashPosition({
      as_of: '2026-01-31T00:00:00.000Z',
      accounts: [
        { account_id: 'a', source: 'tochka', balance: 500000 },
        { account_id: 'b', source: 'tochka', balance: 250000 },
        { account_id: 'c', source: 'moysklad', balance: 100000, currency: 'USD' },
      ],
    });
    expect(pos.totals.RUB).toBe(750000);
    expect(pos.totals.USD).toBe(100000);
    expect(pos.by_account).toHaveLength(3);
  });

  test('rejects a non-integer balance', () => {
    expect(() =>
      makeCashPosition({ accounts: [{ account_id: 'a', source: 'tochka', balance: 1.5 }] })
    ).toThrow(/integer kopecks/);
  });
});

describe('isKopecks', () => {
  test('true only for non-negative integers', () => {
    expect(isKopecks(0)).toBe(true);
    expect(isKopecks(100)).toBe(true);
    expect(isKopecks(-1)).toBe(false);
    expect(isKopecks(1.5)).toBe(false);
  });
});
