'use strict';

const { makeTransaction, makeStatement, signedAmount, DEFAULT_CURRENCY } = require('./model');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addDays(baseDate, days) {
  const [y, m, d] = baseDate.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + days * 86400000;
  return new Date(ms).toISOString();
}

const COUNTERPARTIES = [
  { name: 'OOO Postavshik', inn: '7701234567', bic: '044525225' },
  { name: 'AO Klient', inn: '7802345678', bic: '044030702' },
  { name: 'IP Ivanov', inn: '500100732259', bic: '044525593' },
  { name: 'OOO Arenda', inn: '7703456789', bic: '044525225' },
  { name: 'OOO Logistika', inn: '7704567890', bic: '044525974' },
];

const DEFAULT_SPECS = [
  { type: 'matched', amount: 1500000, direction: 'out' },
  { type: 'matched', amount: 2500000, direction: 'in' },
  { type: 'matched', amount: 999900, direction: 'out' },
  { type: 'missing_in_ledger', amount: 750000, direction: 'out' },
  { type: 'missing_in_bank', amount: 1200000, direction: 'in' },
  { type: 'amount_mismatch', amount: 3000000, ledgerAmount: 2990000, direction: 'out' },
  { type: 'partial_payment', amount: 5000000, paid: 3000000, direction: 'in' },
  { type: 'duplicate', amount: 450000, direction: 'out' },
  { type: 'purpose_ambiguous', amount: 800000, direction: 'out' },
];

function generateCase(opts = {}) {
  const seed = opts.seed || 1;
  const rnd = mulberry32(seed);
  const baseDate = opts.baseDate || '2026-01-01';
  const bankSource = opts.bankSource || 'tochka';
  const ledgerSource = opts.ledgerSource || 'moysklad';
  const accountId = opts.accountId || 'acc-40702810000000000001';
  const ledgerAccountId = opts.ledgerAccountId || accountId;
  const openingBalance = opts.openingBalance === undefined ? 10000000 : opts.openingBalance;
  const specs = opts.specs || DEFAULT_SPECS;

  const bankTxns = [];
  const ledgerTxns = [];
  const matched = [];
  const exceptions = [];

  let dayCursor = 1;
  specs.forEach((spec, i) => {
    const cp = COUNTERPARTIES[Math.floor(rnd() * COUNTERPARTIES.length)];
    const day = dayCursor + Math.floor(rnd() * 2);
    dayCursor += 3;
    const bookedAt = addDays(baseDate, day);
    const docNumber = String(1000 + i);
    const purpose = `Oplata po dogovoru ${docNumber} ${cp.name}`;

    const bankBase = {
      source: bankSource,
      kind: 'bank',
      account_id: accountId,
      direction: spec.direction,
      currency: DEFAULT_CURRENCY,
      booked_at: bookedAt,
      counterparty: cp,
      purpose,
      doc_number: docNumber,
      status: 'posted',
    };
    const ledgerBase = {
      source: ledgerSource,
      kind: 'ledger',
      account_id: ledgerAccountId,
      direction: spec.direction,
      currency: DEFAULT_CURRENCY,
      booked_at: bookedAt,
      counterparty: cp,
      purpose,
      doc_number: docNumber,
      status: 'posted',
    };

    switch (spec.type) {
      case 'matched': {
        const b = makeTransaction({ ...bankBase, amount: spec.amount, native_id: `b-${i}` });
        const l = makeTransaction({ ...ledgerBase, amount: spec.amount, native_id: `l-${i}` });
        bankTxns.push(b);
        ledgerTxns.push(l);
        matched.push({ bank_txn_id: b.id, ledger_entry_id: l.id, amount: spec.amount, match_type: 'exact' });
        break;
      }
      case 'missing_in_ledger': {
        const b = makeTransaction({ ...bankBase, amount: spec.amount, native_id: `b-${i}` });
        bankTxns.push(b);
        exceptions.push({ type: 'missing_in_ledger', bank_txn_id: b.id });
        break;
      }
      case 'missing_in_bank': {
        const l = makeTransaction({ ...ledgerBase, amount: spec.amount, native_id: `l-${i}` });
        ledgerTxns.push(l);
        exceptions.push({ type: 'missing_in_bank', ledger_entry_id: l.id });
        break;
      }
      case 'amount_mismatch': {
        const b = makeTransaction({ ...bankBase, amount: spec.amount, native_id: `b-${i}` });
        const l = makeTransaction({ ...ledgerBase, amount: spec.ledgerAmount, native_id: `l-${i}` });
        bankTxns.push(b);
        ledgerTxns.push(l);
        exceptions.push({
          type: 'amount_mismatch',
          bank_txn_id: b.id,
          ledger_entry_id: l.id,
          delta: spec.amount - spec.ledgerAmount,
        });
        break;
      }
      case 'partial_payment': {
        const b = makeTransaction({ ...bankBase, amount: spec.paid, native_id: `b-${i}` });
        const l = makeTransaction({ ...ledgerBase, amount: spec.amount, native_id: `l-${i}` });
        bankTxns.push(b);
        ledgerTxns.push(l);
        exceptions.push({
          type: 'partial_payment',
          bank_txn_id: b.id,
          ledger_entry_id: l.id,
          delta: spec.amount - spec.paid,
        });
        break;
      }
      case 'duplicate': {
        const b1 = makeTransaction({ ...bankBase, amount: spec.amount, native_id: `b-${i}` });
        const b2 = makeTransaction({ ...bankBase, amount: spec.amount, native_id: `b-${i}` });
        const l = makeTransaction({ ...ledgerBase, amount: spec.amount, native_id: `l-${i}` });
        bankTxns.push(b1, b2);
        ledgerTxns.push(l);
        matched.push({ bank_txn_id: b1.id, ledger_entry_id: l.id, amount: spec.amount, match_type: 'exact' });
        exceptions.push({ type: 'duplicate', bank_txn_id: b2.id, dedup_key: b2.dedup_key });
        break;
      }
      case 'purpose_ambiguous': {
        const b1 = makeTransaction({ ...bankBase, amount: spec.amount, native_id: `b-${i}a` });
        const b2 = makeTransaction({ ...bankBase, amount: spec.amount, native_id: `b-${i}b` });
        const l = makeTransaction({ ...ledgerBase, amount: spec.amount, native_id: `l-${i}` });
        bankTxns.push(b1, b2);
        ledgerTxns.push(l);
        exceptions.push({
          type: 'purpose_ambiguous',
          ledger_entry_id: l.id,
          bank_txn_ids: [b1.id, b2.id],
        });
        break;
      }
      default:
        throw new Error(`synthetic: unknown spec type ${spec.type}`);
    }
  });

  const periodFrom = addDays(baseDate, 0);
  const periodTo = addDays(baseDate, dayCursor + 1);

  const bankNet = bankTxns.reduce((acc, tx) => acc + signedAmount(tx), 0);
  const ledgerNet = ledgerTxns.reduce((acc, tx) => acc + signedAmount(tx), 0);

  const bankStatement = makeStatement({
    account_id: accountId,
    source: bankSource,
    period_from: periodFrom,
    period_to: periodTo,
    opening_balance: openingBalance,
    closing_balance: openingBalance + bankNet,
    fetched_at: periodTo,
    lines: bankTxns,
  });

  const ledgerStatement = makeStatement({
    account_id: ledgerAccountId,
    source: ledgerSource,
    period_from: periodFrom,
    period_to: periodTo,
    opening_balance: openingBalance,
    closing_balance: openingBalance + ledgerNet,
    fetched_at: periodTo,
    lines: ledgerTxns,
  });

  const summary = {
    matched: matched.length,
    matched_amount: matched.reduce((acc, m) => acc + m.amount, 0),
    unmatched_bank: exceptions.filter(
      (e) => e.type === 'missing_in_ledger' || e.type === 'duplicate'
    ).length,
    unmatched_ledger: exceptions.filter((e) => e.type === 'missing_in_bank').length,
    partial: exceptions.filter((e) => e.type === 'partial_payment').length,
  };

  return {
    bank: { statement: bankStatement, transactions: bankTxns },
    ledger: { statement: ledgerStatement, transactions: ledgerTxns },
    expected: { summary, matched, exceptions },
    meta: {
      seed,
      baseDate,
      bankSource,
      ledgerSource,
      accountId,
      period: { from: periodFrom, to: periodTo },
    },
  };
}

module.exports = {
  generateCase,
  mulberry32,
  addDays,
  DEFAULT_SPECS,
  COUNTERPARTIES,
};
