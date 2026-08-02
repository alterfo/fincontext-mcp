'use strict';

const { signedAmount, DEFAULT_CURRENCY } = require('./model');

function toMs(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function daysBetween(a, b) {
  const am = toMs(a);
  const bm = toMs(b);
  if (am === null || bm === null) return 0;
  return Math.round(Math.abs(am - bm) / 86400000);
}

function computeCashPosition(input = {}) {
  const currency = input.currency || DEFAULT_CURRENCY;
  const accounts = input.accounts || [];
  const warnings = [];

  let asOf = input.as_of || null;
  if (!asOf) {
    let maxMs = null;
    for (const a of accounts) {
      const ms = toMs(a.updated_at || a.fetched_at);
      if (ms !== null && (maxMs === null || ms > maxMs)) maxMs = ms;
    }
    asOf = maxMs === null ? null : new Date(maxMs).toISOString();
  }
  const asOfMs = toMs(asOf);

  const byAccount = accounts.map((a) => {
    const lines = a.transactions || [];
    let balance;
    if (a.closing_balance !== undefined && a.closing_balance !== null) {
      balance = a.closing_balance;
    } else {
      const posted = lines.filter((tx) => tx.status === 'posted');
      balance = (a.opening_balance || 0) + posted.reduce((acc, tx) => acc + signedAmount(tx), 0);
    }

    const pending = lines.filter((tx) => tx.status !== 'posted');
    if (pending.length > 0) {
      warnings.push(
        `${a.account_id}: ${pending.length} pending/hold line(s) excluded from cash`
      );
    }

    const acctCurrency = a.currency || DEFAULT_CURRENCY;
    if (acctCurrency !== currency) {
      warnings.push(
        `${a.account_id}: currency ${acctCurrency} excluded from ${currency} total`
      );
    }

    const updatedAt = a.updated_at || a.fetched_at || null;
    const updatedMs = toMs(updatedAt);
    const stalenessSec =
      asOfMs !== null && updatedMs !== null ? Math.max(0, Math.floor((asOfMs - updatedMs) / 1000)) : null;

    return {
      account_id: a.account_id,
      bank: a.source,
      amount: balance,
      currency: acctCurrency,
      updated_at: updatedAt,
      staleness_sec: stalenessSec,
    };
  });

  const totalAmount = byAccount
    .filter((a) => a.currency === currency)
    .reduce((acc, a) => acc + a.amount, 0);

  return {
    as_of: asOf,
    total: { amount: totalAmount, currency },
    by_account: byAccount,
    warnings,
  };
}

function linkKey(tx) {
  const cp = tx.counterparty || {};
  if (tx.uin) return `uin:${tx.direction}:${tx.uin}`;
  if (tx.doc_number) return `doc:${tx.direction}:${tx.doc_number}`;
  if (cp.inn) return `inn:${tx.direction}:${cp.inn}`;
  return `p:${tx.direction}:${tx.purpose || ''}`;
}

function dedup(txns, side, exceptions) {
  const seen = new Map();
  const kept = [];
  for (const tx of txns) {
    if (seen.has(tx.dedup_key)) {
      exceptions.push({
        type: 'duplicate',
        side,
        [side === 'bank' ? 'bank_txn_id' : 'ledger_entry_id']: tx.id,
        dedup_key: tx.dedup_key,
        suggestion: 'Duplicate operation (same dedup_key); drop the extra copy.',
      });
    } else {
      seen.set(tx.dedup_key, true);
      kept.push(tx);
    }
  }
  return kept;
}

function reconcile(input = {}) {
  const tolerance = {
    amount_minor: (input.tolerance && input.tolerance.amount_minor) || 0,
    days: (input.tolerance && input.tolerance.days) || 0,
  };

  const matched = [];
  const exceptions = [];

  const bank = dedup(input.bank || [], 'bank', exceptions);
  const ledger = dedup(input.ledger || [], 'ledger', exceptions);

  const groups = new Map();
  const group = (key) => {
    if (!groups.has(key)) groups.set(key, { bank: [], ledger: [] });
    return groups.get(key);
  };
  for (const tx of bank) group(linkKey(tx)).bank.push(tx);
  for (const tx of ledger) group(linkKey(tx)).ledger.push(tx);

  for (const g of groups.values()) {
    const b = g.bank;
    const l = g.ledger;

    if (b.length === 1 && l.length === 1) {
      const bt = b[0];
      const lt = l[0];
      const delta = bt.amount - lt.amount;
      const dateDiff = daysBetween(bt.booked_at, lt.booked_at);

      if (delta === 0 && dateDiff === 0) {
        matched.push({
          bank_txn_id: bt.id,
          ledger_entry_id: lt.id,
          amount: bt.amount,
          match_type: 'exact',
        });
      } else if (Math.abs(delta) <= tolerance.amount_minor && dateDiff <= tolerance.days) {
        matched.push({
          bank_txn_id: bt.id,
          ledger_entry_id: lt.id,
          amount: bt.amount,
          match_type: 'tolerance',
        });
      } else if (bt.amount < lt.amount) {
        const d = lt.amount - bt.amount;
        exceptions.push({
          type: 'partial_payment',
          bank_txn_id: bt.id,
          ledger_entry_id: lt.id,
          delta: d,
          suggestion: `Bank shows ${d} kopecks less than the ledger; likely a partial payment, ${d} still outstanding.`,
        });
      } else {
        exceptions.push({
          type: 'amount_mismatch',
          bank_txn_id: bt.id,
          ledger_entry_id: lt.id,
          delta,
          suggestion: `Amounts differ by ${delta} kopecks; verify the posted amount.`,
        });
      }
    } else if (b.length >= 1 && l.length === 0) {
      for (const bt of b) {
        exceptions.push({
          type: 'missing_in_ledger',
          bank_txn_id: bt.id,
          suggestion: 'Bank operation has no matching ledger entry; create the ledger posting.',
        });
      }
    } else if (b.length === 0 && l.length >= 1) {
      for (const lt of l) {
        exceptions.push({
          type: 'missing_in_bank',
          ledger_entry_id: lt.id,
          suggestion: 'Ledger entry has no matching bank operation; the payment may not have cleared.',
        });
      }
    } else {
      exceptions.push({
        type: 'purpose_ambiguous',
        bank_txn_ids: b.map((tx) => tx.id),
        ledger_entry_ids: l.map((tx) => tx.id),
        ...(l.length === 1 ? { ledger_entry_id: l[0].id } : {}),
        ...(b.length === 1 ? { bank_txn_id: b[0].id } : {}),
        suggestion:
          'Multiple operations match one entry; cannot determine which clears it.',
      });
    }
  }

  const count = (type, side) =>
    exceptions.filter((e) => e.type === type && (side ? e.side === side : true)).length;

  const summary = {
    matched: matched.length,
    matched_amount: matched.reduce((acc, m) => acc + m.amount, 0),
    unmatched_bank: count('missing_in_ledger') + count('duplicate', 'bank'),
    unmatched_ledger: count('missing_in_bank') + count('duplicate', 'ledger'),
    partial: count('partial_payment'),
  };

  return { summary, matched, exceptions };
}

const FIELD_WEIGHTS = {
  uin: 0.6,
  doc_number: 0.5,
  amount: 0.35,
  counterparty_inn: 0.35,
  purpose_contains: 0.2,
};

const CONFIDENCE_THRESHOLD = 0.5;

function checkPayment(transactions = [], query = {}) {
  const providedFields = Object.keys(FIELD_WEIGHTS).filter(
    (f) => query[f] !== undefined && query[f] !== null && query[f] !== ''
  );

  const fromMs = toMs(query.date_from);
  const toDateMs = toMs(query.date_to);

  const candidates = [];
  for (const tx of transactions) {
    const bookedMs = toMs(tx.booked_at);
    if (fromMs !== null && bookedMs !== null && bookedMs < fromMs) continue;
    if (toDateMs !== null && bookedMs !== null && bookedMs > toDateMs + 86399999) continue;

    let matchedWeight = 0;
    const cp = tx.counterparty || {};
    if (query.uin && tx.uin === query.uin) matchedWeight += FIELD_WEIGHTS.uin;
    if (query.doc_number && tx.doc_number === query.doc_number) matchedWeight += FIELD_WEIGHTS.doc_number;
    if (query.amount !== undefined && query.amount !== null && tx.amount === query.amount) {
      matchedWeight += FIELD_WEIGHTS.amount;
    }
    if (query.counterparty_inn && cp.inn === query.counterparty_inn) {
      matchedWeight += FIELD_WEIGHTS.counterparty_inn;
    }
    if (
      query.purpose_contains &&
      tx.purpose &&
      tx.purpose.toLowerCase().includes(String(query.purpose_contains).toLowerCase())
    ) {
      matchedWeight += FIELD_WEIGHTS.purpose_contains;
    }

    if (matchedWeight <= 0) continue;
    const confidence = Math.min(1, matchedWeight);
    candidates.push({ transaction: tx, account_id: tx.account_id, confidence });
  }

  candidates.sort((a, b) => b.confidence - a.confidence);

  const strong = candidates.filter((c) => c.confidence >= CONFIDENCE_THRESHOLD);
  let status = 'not_found';
  if (strong.length > 0) {
    status = strong.some((c) => c.transaction.status === 'posted') ? 'found' : 'pending';
  }

  let explanation;
  if (providedFields.length === 0) {
    explanation = 'No search criteria supplied; nothing to match.';
  } else if (status === 'found') {
    const top = strong[0];
    explanation = `Found a cleared payment matching ${providedFields.join(', ')} (confidence ${top.confidence.toFixed(2)}).`;
  } else if (status === 'pending') {
    explanation = 'A matching payment exists but is still pending/on hold; it has not cleared yet.';
  } else if (candidates.length > 0) {
    explanation = `Only weak matches below the confidence threshold (${CONFIDENCE_THRESHOLD}); treat as not found.`;
  } else {
    explanation = 'No transaction matched the supplied criteria.';
  }

  return { status, matches: strong.length > 0 ? strong : candidates, explanation };
}

module.exports = {
  computeCashPosition,
  reconcile,
  checkPayment,
  daysBetween,
  linkKey,
};
