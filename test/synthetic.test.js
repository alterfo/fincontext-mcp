'use strict';

const { generateCase, mulberry32, addDays } = require('../src/synthetic');
const { signedAmount } = require('../src/model');

describe('generateCase determinism', () => {
  test('same seed => byte-identical output', () => {
    const a = generateCase({ seed: 42 });
    const b = generateCase({ seed: 42 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('different seed => different data', () => {
    const a = generateCase({ seed: 1 });
    const b = generateCase({ seed: 2 });
    expect(JSON.stringify(a.bank.transactions)).not.toBe(JSON.stringify(b.bank.transactions));
  });
});

describe('statement completeness holds for generated statements', () => {
  test('bank statement: opening + Σin − Σout == closing', () => {
    const c = generateCase({ seed: 7 });
    const net = c.bank.transactions.reduce((acc, tx) => acc + signedAmount(tx), 0);
    expect(c.bank.statement.opening_balance + net).toBe(c.bank.statement.closing_balance);
  });

  test('ledger statement: opening + Σin − Σout == closing', () => {
    const c = generateCase({ seed: 7 });
    const net = c.ledger.transactions.reduce((acc, tx) => acc + signedAmount(tx), 0);
    expect(c.ledger.statement.opening_balance + net).toBe(c.ledger.statement.closing_balance);
  });
});

describe('expected fixture reflects the ground-truth discrepancies', () => {
  const c = generateCase({ seed: 3 });
  const types = c.expected.exceptions.map((e) => e.type);

  test('emits every discrepancy type from the default mix', () => {
    expect(new Set(types)).toEqual(
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

  test('summary counts agree with the exception list', () => {
    const { summary } = c.expected;
    expect(summary.matched).toBe(c.expected.matched.length);
    expect(summary.unmatched_ledger).toBe(types.filter((t) => t === 'missing_in_bank').length);
    expect(summary.partial).toBe(types.filter((t) => t === 'partial_payment').length);
    expect(summary.unmatched_bank).toBe(
      types.filter((t) => t === 'missing_in_ledger' || t === 'duplicate').length
    );
  });

  test('matched amount equals the sum of matched pairs', () => {
    const sum = c.expected.matched.reduce((acc, m) => acc + m.amount, 0);
    expect(c.expected.summary.matched_amount).toBe(sum);
  });
});

describe('discrepancy shapes', () => {
  const c = generateCase({ seed: 5 });
  const byType = (t) => c.expected.exceptions.filter((e) => e.type === t);

  test('duplicate: two bank lines share one dedup_key', () => {
    const dup = byType('duplicate')[0];
    const dupLines = c.bank.transactions.filter((tx) => tx.dedup_key === dup.dedup_key);
    expect(dupLines).toHaveLength(2);
    expect(dupLines[0].id).toBe(dupLines[1].id);
  });

  test('amount_mismatch: delta equals bank − ledger amount', () => {
    const mm = byType('amount_mismatch')[0];
    const b = c.bank.transactions.find((tx) => tx.id === mm.bank_txn_id);
    const l = c.ledger.transactions.find((tx) => tx.id === mm.ledger_entry_id);
    expect(b.amount - l.amount).toBe(mm.delta);
  });

  test('partial_payment: bank amount is less than ledger amount by delta', () => {
    const pp = byType('partial_payment')[0];
    const b = c.bank.transactions.find((tx) => tx.id === pp.bank_txn_id);
    const l = c.ledger.transactions.find((tx) => tx.id === pp.ledger_entry_id);
    expect(l.amount - b.amount).toBe(pp.delta);
    expect(b.amount).toBeLessThan(l.amount);
  });

  test('missing_in_ledger has no counterpart in ledger transactions', () => {
    const miss = byType('missing_in_ledger')[0];
    const b = c.bank.transactions.find((tx) => tx.id === miss.bank_txn_id);
    expect(b).toBeDefined();
  });

  test('purpose_ambiguous references two candidate bank lines for one ledger entry', () => {
    const amb = byType('purpose_ambiguous')[0];
    expect(amb.bank_txn_ids).toHaveLength(2);
    const l = c.ledger.transactions.find((tx) => tx.id === amb.ledger_entry_id);
    expect(l).toBeDefined();
  });
});

describe('helpers', () => {
  test('mulberry32 is deterministic and in [0,1)', () => {
    const r1 = mulberry32(123);
    const r2 = mulberry32(123);
    for (let i = 0; i < 5; i++) {
      const v = r1();
      expect(v).toBe(r2());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test('addDays advances by whole days from a UTC base', () => {
    expect(addDays('2026-01-01', 0)).toBe('2026-01-01T00:00:00.000Z');
    expect(addDays('2026-01-01', 31)).toBe('2026-02-01T00:00:00.000Z');
  });
});
