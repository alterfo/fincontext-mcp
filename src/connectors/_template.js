'use strict';

const { makeTransaction, DEFAULT_CURRENCY } = require('../model');

const DIRECTION_BY_TYPE = {
  payout: 'in',
  sale: 'in',
  refund: 'out',
  commission: 'out',
  fee: 'out',
};

function toKopecks(value) {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return Math.round(value * 100);
  const text = String(value).trim().replace(/\s+/g, '').replace(',', '.');
  const negative = text.startsWith('-');
  const clean = negative ? text.slice(1) : text;
  const [whole, fraction = ''] = clean.split('.');
  const kopecks = Number(whole || '0') * 100 + Number(`${fraction}00`.slice(0, 2));
  return negative ? -kopecks : kopecks;
}

function normalizeRow(row, ctx) {
  const type = String(row.type || 'payout').toLowerCase();
  return makeTransaction({
    source: ctx.source,
    kind: 'marketplace',
    account_id: String(row.account_id || ctx.source),
    native_id: row.id !== undefined ? String(row.id) : undefined,
    direction: row.direction || DIRECTION_BY_TYPE[type] || 'in',
    amount: Math.abs(toKopecks(row.amount)),
    currency: row.currency || DEFAULT_CURRENCY,
    booked_at: String(row.date || row.moment || ''),
    value_date: row.expected_payout_date || null,
    status: row.status === 'planned' ? 'pending' : 'posted',
    counterparty: row.buyer ? { name: String(row.buyer) } : null,
    purpose: row.description || type,
    doc_number: row.order_number ? String(row.order_number) : null,
    category: type,
    raw: row,
  });
}

function createConnectorTemplate(opts = {}) {
  const source = opts.source || 'ozon';
  const token = opts.token;
  const baseUrl = opts.baseUrl || '';
  const http =
    opts.http ||
    (() => {
      throw new Error(`${source}: no http client configured (inject opts.http or implement fetch)`);
    });

  async function listRows(period) {
    if (!token) throw new Error(`${source}: token required`);
    const res = await http(`${baseUrl}/finance/transactions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: period.from || null, to: period.to || null }),
    });
    if (!res || !res.ok) {
      const status = res ? res.status : 'no-response';
      throw new Error(`${source}: finance list -> ${status}`);
    }
    const data = await res.json();
    return data.rows || data.result || [];
  }

  async function pull(period = {}) {
    const rows = await listRows(period);
    const transactions = rows.map((row) => normalizeRow(row, { source }));
    return { accounts: [], statements: [], transactions };
  }

  return { source, listRows, pull };
}

module.exports = {
  createConnectorTemplate,
  normalizeRow,
  toKopecks,
  DIRECTION_BY_TYPE,
};
