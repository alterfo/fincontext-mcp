'use strict';

const { makeTransaction, DEFAULT_CURRENCY } = require('../model');

const SOURCE = 'tochka';
const SANDBOX_BASE_URL = 'https://enter.tochka.com/sandbox/v2';
const API = '/open-banking/v1.0';

const STATUS_MAP = {
  Booked: 'posted',
  Posted: 'posted',
  Pending: 'pending',
  InProgress: 'pending',
  Hold: 'hold',
  Information: 'hold',
};

const CLOSING_BALANCE_PRIORITY = ['ClosingAvailable', 'ClosingBooked', 'Closing', 'Expected'];

function pick(obj, ...names) {
  if (!obj) return undefined;
  for (const name of names) {
    if (obj[name] !== undefined && obj[name] !== null) return obj[name];
  }
  return undefined;
}

function pickList(payload, key) {
  const data = (payload && (payload.Data || payload.data)) || {};
  const value = data[key] !== undefined ? data[key] : data[key.toLowerCase()];
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function pickOne(payload, key) {
  const list = pickList(payload, key);
  return list.length ? list[0] : null;
}

function rublesToKopecks(value) {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return Math.round(value * 100);
  const text = String(value).trim().replace(/\s+/g, '').replace(',', '.');
  const negative = text.startsWith('-');
  const clean = negative ? text.slice(1) : text;
  const [whole, fraction = ''] = clean.split('.');
  const kopStr = `${fraction}00`.slice(0, 2);
  const kopecks = Number(whole || '0') * 100 + Number(kopStr || '0');
  return negative ? -kopecks : kopecks;
}

function amountKopecks(amountObj) {
  if (amountObj === undefined || amountObj === null) return 0;
  if (typeof amountObj === 'object') {
    return Math.abs(rublesToKopecks(pick(amountObj, 'amount', 'value', 'Amount')));
  }
  return Math.abs(rublesToKopecks(amountObj));
}

function amountCurrency(amountObj, fallback) {
  if (amountObj && typeof amountObj === 'object') {
    return pick(amountObj, 'currency', 'Currency') || fallback || DEFAULT_CURRENCY;
  }
  return fallback || DEFAULT_CURRENCY;
}

function indicatorToDirection(indicator) {
  return String(indicator || '').toLowerCase().startsWith('debit') ? 'out' : 'in';
}

function mapStatus(status) {
  if (!status) return 'posted';
  return STATUS_MAP[status] || 'posted';
}

function normalizeAccount(raw) {
  const accountId = String(
    pick(raw, 'accountId', 'accountID', 'id', 'account', 'number')
  );
  const servicer = pick(raw, 'servicer', 'Servicer') || {};
  return {
    account_id: accountId,
    source: SOURCE,
    bank: SOURCE,
    title: pick(raw, 'nickname', 'title', 'name') || null,
    currency: pick(raw, 'currency', 'Currency') || DEFAULT_CURRENCY,
    bic: pick(servicer, 'bankId', 'bic', 'identification') || null,
    opening_balance: 0,
    updated_at: pick(raw, 'dateTime', 'updatedAt') || null,
  };
}

function extractCounterparty(raw, direction) {
  const party =
    direction === 'in'
      ? pick(raw, 'DebtorParty', 'debtorParty', 'payer')
      : pick(raw, 'CreditorParty', 'creditorParty', 'payee');
  const account =
    direction === 'in'
      ? pick(raw, 'DebtorAccount', 'debtorAccount')
      : pick(raw, 'CreditorAccount', 'creditorAccount');
  const cp = {};
  if (party) {
    const name = pick(party, 'name', 'Name');
    const inn = pick(party, 'inn', 'INN', 'taxCode');
    const kpp = pick(party, 'kpp', 'KPP');
    if (name) cp.name = String(name);
    if (inn) cp.inn = String(inn);
    if (kpp) cp.kpp = String(kpp);
  }
  if (account) {
    const number = pick(account, 'identification', 'account', 'number');
    const bic = pick(account, 'servicerIdentification', 'bic', 'bankId');
    if (number) cp.account = String(number);
    if (bic) cp.bic = String(bic);
  }
  return Object.keys(cp).length ? cp : null;
}

function normalizeTransaction(raw, ctx = {}) {
  const accountId = String(ctx.accountId || pick(raw, 'accountId', 'accountID') || '');
  const amountObj = pick(raw, 'amount', 'Amount');
  const direction = indicatorToDirection(
    pick(raw, 'creditDebitIndicator', 'CreditDebitIndicator', 'direction')
  );
  const nativeId = pick(
    raw,
    'transactionId',
    'transactionID',
    'id',
    'documentId',
    'operationId'
  );
  const counterparty = extractCounterparty(raw, direction);
  return makeTransaction({
    source: SOURCE,
    kind: 'bank',
    account_id: accountId,
    native_id: nativeId !== undefined ? String(nativeId) : undefined,
    direction,
    amount: amountKopecks(amountObj),
    currency: amountCurrency(amountObj, ctx.currency),
    booked_at: String(
      pick(raw, 'bookingDateTime', 'documentDate', 'date', 'operationDate') || ''
    ),
    value_date: pick(raw, 'valueDateTime', 'valueDate') || null,
    status: mapStatus(pick(raw, 'status', 'Status')),
    counterparty,
    purpose:
      pick(raw, 'transactionInformation', 'description', 'purpose', 'paymentPurpose') ||
      null,
    doc_number:
      pick(raw, 'documentProductNumber', 'documentNumber', 'paymentNumber') || null,
    uin: pick(raw, 'uin', 'UIN') || null,
    raw,
  });
}

function balanceSignedKopecks(entry) {
  const kopecks = amountKopecks(pick(entry, 'amount', 'Amount'));
  const indicator = pick(entry, 'creditDebitIndicator', 'CreditDebitIndicator');
  return indicatorToDirection(indicator) === 'out' ? -kopecks : kopecks;
}

function pickClosingBalance(balances) {
  if (!balances || balances.length === 0) return null;
  let chosen = null;
  let bestRank = Infinity;
  for (const entry of balances) {
    const type = pick(entry, 'type', 'Type') || '';
    const rank = CLOSING_BALANCE_PRIORITY.indexOf(type);
    const effective = rank === -1 ? CLOSING_BALANCE_PRIORITY.length : rank;
    if (effective < bestRank) {
      bestRank = effective;
      chosen = entry;
    }
  }
  if (!chosen) chosen = balances[0];
  return {
    closing_balance: balanceSignedKopecks(chosen),
    currency: amountCurrency(pick(chosen, 'amount', 'Amount')),
    updated_at: pick(chosen, 'dateTime', 'DateTime', 'date') || null,
  };
}

function normalizeStatement(raw, accountId) {
  const start = pick(raw, 'startBalance', 'StartBalance', 'openingBalance');
  const end = pick(raw, 'endBalance', 'EndBalance', 'closingBalance');
  return {
    account_id: accountId,
    period_from: pick(raw, 'startDateTime', 'periodFrom', 'from') || null,
    period_to: pick(raw, 'endDateTime', 'periodTo', 'to') || null,
    opening_balance: start ? balanceSignedKopecks(start) : null,
    closing_balance: end ? balanceSignedKopecks(end) : null,
    fetched_at: pick(raw, 'creationDateTime', 'fetchedAt') || null,
    raw_transactions: pickList({ Data: { Transaction: pick(raw, 'Transaction', 'transactions') } }, 'Transaction'),
  };
}

function createTochkaConnector(opts = {}) {
  const token = opts.token;
  const baseUrl = opts.baseUrl || SANDBOX_BASE_URL;
  const http = opts.http || ((url, init) => globalThis.fetch(url, init));

  async function request(method, path, body) {
    if (!token) throw new Error('tochka: token required');
    const res = await http(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = '';
      if (typeof res.text === 'function') {
        detail = await res.text().catch(() => '');
      }
      throw new Error(`tochka: ${method} ${path} -> ${res.status} ${detail}`.trim());
    }
    return res.json();
  }

  async function listAccounts() {
    const data = await request('GET', `${API}/accounts`);
    return pickList(data, 'Account');
  }

  async function getBalances(accountId) {
    const data = await request('GET', `${API}/accounts/${accountId}/balances`);
    return pickList(data, 'Balance');
  }

  async function getStatement(accountId, period = {}) {
    const created = await request('POST', `${API}/statements`, {
      Data: {
        Statement: {
          accountId,
          startDateTime: period.from || null,
          endDateTime: period.to || null,
        },
      },
    });
    const requested = pickOne(created, 'Statement') || {};
    const statementId = pick(requested, 'statementId', 'statementID', 'id');
    if (statementId) {
      const fetched = await request(
        'GET',
        `${API}/accounts/${accountId}/statements/${statementId}`
      );
      return pickOne(fetched, 'Statement') || requested;
    }
    return requested;
  }

  async function pull(period = {}) {
    const rawAccounts = await listAccounts();
    const accounts = [];
    const statements = [];
    const transactions = [];

    for (const rawAccount of rawAccounts) {
      const account = normalizeAccount(rawAccount);
      const balances = await getBalances(account.account_id).catch(() => []);
      const closing = pickClosingBalance(balances);
      if (closing) {
        account.closing_balance = closing.closing_balance;
        account.currency = closing.currency || account.currency;
        account.updated_at = closing.updated_at || account.updated_at;
      }
      accounts.push(account);

      if (period.from || period.to) {
        const rawStatement = await getStatement(account.account_id, period);
        const statement = normalizeStatement(rawStatement, account.account_id);
        const lineIds = [];
        for (const rawTx of statement.raw_transactions) {
          const tx = normalizeTransaction(rawTx, {
            accountId: account.account_id,
            currency: account.currency,
          });
          transactions.push(tx);
          lineIds.push(tx.id);
        }
        statements.push({
          account_id: account.account_id,
          source: SOURCE,
          period_from: statement.period_from,
          period_to: statement.period_to,
          opening_balance: statement.opening_balance,
          closing_balance: statement.closing_balance,
          fetched_at: statement.fetched_at || account.updated_at || period.as_of || null,
          line_ids: lineIds,
        });
      }
    }

    return { accounts, statements, transactions };
  }

  return {
    source: SOURCE,
    listAccounts,
    getBalances,
    getStatement,
    pull,
  };
}

module.exports = {
  SOURCE,
  SANDBOX_BASE_URL,
  createTochkaConnector,
  normalizeAccount,
  normalizeTransaction,
  normalizeStatement,
  pickClosingBalance,
  rublesToKopecks,
};
