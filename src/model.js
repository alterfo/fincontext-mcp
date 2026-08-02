'use strict';

const crypto = require('crypto');

const SOURCES = ['tochka', 'moysklad', 'kontur', '1c', 'ozon', 'wb'];
const KINDS = ['bank', 'ledger', 'marketplace'];
const DIRECTIONS = ['in', 'out'];
const STATUSES = ['posted', 'pending', 'hold'];
const DEFAULT_CURRENCY = 'RUB';

function hashParts(...parts) {
  const h = crypto.createHash('sha256');
  h.update(parts.map((p) => (p === undefined || p === null ? '' : String(p))).join('\u0000'));
  return h.digest('hex').slice(0, 32);
}

function computeId(source, accountId, nativeId) {
  return hashParts(source, accountId, nativeId);
}

function computeDedupKey(tx) {
  if (tx.native_id !== undefined && tx.native_id !== null && tx.native_id !== '') {
    return hashParts(tx.source, tx.account_id, tx.native_id);
  }
  return hashParts(
    tx.source,
    tx.account_id,
    tx.booked_at,
    tx.amount,
    tx.direction,
    tx.doc_number || tx.purpose
  );
}

function assert(cond, message) {
  if (!cond) throw new Error(`model: ${message}`);
}

function isKopecks(value) {
  return Number.isInteger(value) && value >= 0;
}

function makeTransaction(input) {
  assert(SOURCES.includes(input.source), `unknown source: ${input.source}`);
  assert(KINDS.includes(input.kind), `unknown kind: ${input.kind}`);
  assert(DIRECTIONS.includes(input.direction), `unknown direction: ${input.direction}`);
  assert(typeof input.account_id === 'string' && input.account_id.length > 0, 'account_id required');
  assert(isKopecks(input.amount), 'amount must be a non-negative integer (kopecks)');
  assert(typeof input.booked_at === 'string' && input.booked_at.length > 0, 'booked_at required');
  const status = input.status || 'posted';
  assert(STATUSES.includes(status), `unknown status: ${status}`);
  if (input.vat_amount !== undefined && input.vat_amount !== null) {
    assert(isKopecks(input.vat_amount), 'vat_amount must be a non-negative integer (kopecks)');
  }

  const nativeId = input.native_id !== undefined ? input.native_id : null;
  const tx = {
    id: input.id || computeId(input.source, input.account_id, nativeId),
    source: input.source,
    kind: input.kind,
    account_id: input.account_id,
    direction: input.direction,
    amount: input.amount,
    currency: input.currency || DEFAULT_CURRENCY,
    booked_at: input.booked_at,
    value_date: input.value_date || null,
    status,
    counterparty: input.counterparty || null,
    purpose: input.purpose || null,
    doc_number: input.doc_number || null,
    uin: input.uin || null,
    vat_amount: input.vat_amount === undefined ? null : input.vat_amount,
    category: input.category || null,
    native_id: nativeId,
    raw: input.raw === undefined ? null : input.raw,
  };
  tx.dedup_key = input.dedup_key || computeDedupKey(tx);
  return tx;
}

function signedAmount(tx) {
  return tx.direction === 'in' ? tx.amount : -tx.amount;
}

function makeStatement(input) {
  const lines = input.lines || [];
  assert(SOURCES.includes(input.source), `unknown source: ${input.source}`);
  assert(typeof input.account_id === 'string' && input.account_id.length > 0, 'account_id required');
  assert(isKopecks(input.opening_balance), 'opening_balance must be integer kopecks');
  assert(Number.isInteger(input.closing_balance), 'closing_balance must be integer kopecks');

  const net = lines.reduce((acc, tx) => acc + signedAmount(tx), 0);
  const derivedClosing = input.opening_balance + net;
  assert(
    derivedClosing === input.closing_balance,
    `statement not complete: opening ${input.opening_balance} + net ${net} = ${derivedClosing} != closing ${input.closing_balance}`
  );

  return {
    account_id: input.account_id,
    source: input.source,
    period_from: input.period_from,
    period_to: input.period_to,
    opening_balance: input.opening_balance,
    closing_balance: input.closing_balance,
    fetched_at: input.fetched_at || null,
    line_ids: lines.map((tx) => tx.id),
  };
}

function makeCashPosition(input) {
  const asOf = input.as_of;
  const byAccount = (input.accounts || []).map((a) => {
    assert(Number.isInteger(a.balance), `balance must be integer kopecks for ${a.account_id}`);
    return {
      account_id: a.account_id,
      source: a.source,
      balance: a.balance,
      currency: a.currency || DEFAULT_CURRENCY,
      updated_at: a.updated_at || null,
    };
  });

  const totals = {};
  for (const a of byAccount) {
    totals[a.currency] = (totals[a.currency] || 0) + a.balance;
  }

  return { as_of: asOf, by_account: byAccount, totals };
}

module.exports = {
  SOURCES,
  KINDS,
  DIRECTIONS,
  STATUSES,
  DEFAULT_CURRENCY,
  hashParts,
  computeId,
  computeDedupKey,
  isKopecks,
  signedAmount,
  makeTransaction,
  makeStatement,
  makeCashPosition,
};
