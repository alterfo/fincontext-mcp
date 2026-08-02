'use strict';

const { makeTransaction, DEFAULT_CURRENCY } = require('../model');

const SOURCE = 'moysklad';
const BASE_URL = 'https://api.moysklad.ru/api/remap/1.2';
const LEDGER_ACCOUNT = 'ledger';

const DOC_DIRECTION = {
  paymentin: 'in',
  cashin: 'in',
  paymentout: 'out',
  cashout: 'out',
};

function pick(obj, ...names) {
  if (!obj) return undefined;
  for (const name of names) {
    if (obj[name] !== undefined && obj[name] !== null) return obj[name];
  }
  return undefined;
}

function toKopecks(sum) {
  if (sum === undefined || sum === null || sum === '') return 0;
  return Math.abs(Math.round(Number(sum)));
}

function normalizeMoment(moment) {
  if (!moment) return '';
  const text = String(moment).trim();
  return text.includes(' ') ? text.replace(' ', 'T') : text;
}

function extractCurrency(raw) {
  const rate = pick(raw, 'rate', 'Rate');
  const currency = rate && pick(rate, 'currency', 'Currency');
  const name = currency && pick(currency, 'isoCode', 'name', 'Name');
  return name || DEFAULT_CURRENCY;
}

function extractCounterparty(raw) {
  const agent = pick(raw, 'agent', 'Agent') || {};
  const account = pick(raw, 'agentAccount', 'AgentAccount') || {};
  const cp = {};
  const name = pick(agent, 'name', 'Name');
  const inn = pick(agent, 'inn', 'INN');
  const kpp = pick(agent, 'kpp', 'KPP');
  if (name) cp.name = String(name);
  if (inn) cp.inn = String(inn);
  if (kpp) cp.kpp = String(kpp);
  const number = pick(account, 'accountNumber', 'account');
  const bic = pick(account, 'bic', 'bankId');
  if (number) cp.account = String(number);
  if (bic) cp.bic = String(bic);
  return Object.keys(cp).length ? cp : null;
}

function accountIdFor(raw) {
  const orgAccount = pick(raw, 'organizationAccount', 'OrganizationAccount');
  const number = orgAccount && pick(orgAccount, 'accountNumber', 'account');
  return number ? String(number) : LEDGER_ACCOUNT;
}

function normalizeTransaction(raw, ctx = {}) {
  const type = String(ctx.type || pick(raw, 'meta') && pick(pick(raw, 'meta'), 'type') || '').toLowerCase();
  const direction = ctx.direction || DOC_DIRECTION[type] || 'in';
  const nativeId = pick(raw, 'id', 'ID');
  const vat = pick(raw, 'vatSum', 'VatSum');
  return makeTransaction({
    source: SOURCE,
    kind: 'ledger',
    account_id: String(ctx.accountId || accountIdFor(raw)),
    native_id: nativeId !== undefined ? String(nativeId) : undefined,
    direction,
    amount: toKopecks(pick(raw, 'sum', 'Sum')),
    currency: extractCurrency(raw),
    booked_at: normalizeMoment(pick(raw, 'moment', 'Moment', 'created')),
    status: 'posted',
    counterparty: extractCounterparty(raw),
    purpose: pick(raw, 'paymentPurpose', 'description', 'name') || null,
    doc_number: pick(raw, 'name', 'Name') || null,
    vat_amount: vat !== undefined && vat !== null ? toKopecks(vat) : null,
    raw,
  });
}

function createMoyskladConnector(opts = {}) {
  const token = opts.token;
  const baseUrl = opts.baseUrl || BASE_URL;
  const http = opts.http || ((url, init) => globalThis.fetch(url, init));
  const documentTypes = opts.documentTypes || ['paymentin', 'paymentout'];

  async function request(method, path) {
    if (!token) throw new Error('moysklad: token required');
    const res = await http(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json;charset=utf-8',
      },
    });
    if (!res.ok) {
      let detail = '';
      if (typeof res.text === 'function') {
        detail = await res.text().catch(() => '');
      }
      throw new Error(`moysklad: ${method} ${path} -> ${res.status} ${detail}`.trim());
    }
    return res.json();
  }

  function filterFor(period = {}) {
    const clauses = [];
    if (period.from) clauses.push(`moment>=${period.from}`);
    if (period.to) clauses.push(`moment<=${period.to}`);
    return clauses.length ? `&filter=${encodeURIComponent(clauses.join(';'))}` : '';
  }

  async function listDocuments(type, period = {}) {
    const query = `?expand=agent,agentAccount,organizationAccount${filterFor(period)}`;
    const data = await request('GET', `/entity/${type}${query}`);
    const rows = (data && (data.rows || data.Rows)) || [];
    return Array.isArray(rows) ? rows : [];
  }

  async function pull(period = {}) {
    const transactions = [];
    for (const type of documentTypes) {
      const rows = await listDocuments(type, period);
      for (const raw of rows) {
        transactions.push(normalizeTransaction(raw, { type }));
      }
    }
    return { accounts: [], statements: [], transactions };
  }

  return {
    source: SOURCE,
    listDocuments,
    pull,
  };
}

module.exports = {
  SOURCE,
  BASE_URL,
  createMoyskladConnector,
  normalizeTransaction,
  toKopecks,
  normalizeMoment,
};
