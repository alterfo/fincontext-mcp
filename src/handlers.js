'use strict';

const { computeCashPosition, checkPayment, reconcile } = require('./reconcile');
const { DEFAULT_CURRENCY, hashParts } = require('./model');

async function buildAccountInputs(store, filterIds) {
  const accounts = await store.listAccounts();
  const statements = await store.listStatements();
  const transactions = await store.listTransactions({});
  const wanted = Array.isArray(filterIds) && filterIds.length ? new Set(filterIds) : null;

  return accounts
    .filter((a) => !wanted || wanted.has(a.account_id))
    .map((a) => {
      const stmts = statements
        .filter((s) => s.account_id === a.account_id && s.source === a.source)
        .sort((x, y) => String(y.period_to).localeCompare(String(x.period_to)));
      const latest = stmts.length ? stmts[0] : null;
      const closing =
        latest && latest.closing_balance !== undefined && latest.closing_balance !== null
          ? latest.closing_balance
          : undefined;
      const txns = transactions.filter(
        (t) => t.account_id === a.account_id && t.source === a.source
      );
      return {
        account_id: a.account_id,
        source: a.source,
        currency: a.currency || DEFAULT_CURRENCY,
        updated_at: a.updated_at || null,
        opening_balance: Number.isInteger(a.opening_balance) ? a.opening_balance : 0,
        closing_balance: closing,
        transactions: txns,
      };
    });
}

function createOpenHandlers(store) {
  return {
    get_cash_position: async (args = {}) => {
      const accounts = await buildAccountInputs(store, args.accounts);
      return computeCashPosition({
        as_of: args.as_of || null,
        currency: args.currency || DEFAULT_CURRENCY,
        accounts,
      });
    },
    check_payment: async (args = {}) => {
      const transactions = await store.listTransactions({});
      return checkPayment(transactions, args);
    },
  };
}

function periodBounds(period = {}) {
  const from = period.from || null;
  let to = period.to || null;
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) to = `${to}T23:59:59.999Z`;
  return { from, to };
}

function withinPeriod(tx, from, to) {
  const at = String(tx.booked_at || '');
  if (from && at < String(from)) return false;
  if (to && at > String(to)) return false;
  return true;
}

async function loadReconcileSide(store, source, kind, from, to) {
  const rows = await store.listTransactions({ source, kind });
  return rows.filter((tx) => withinPeriod(tx, from, to));
}

function createReconcileHandler(store) {
  return async (args = {}) => {
    const period = args.period || {};
    const bankSource = args.bank_source;
    const ledgerSource = args.ledger_source;
    const tolerance = args.tolerance || {};
    const { from, to } = periodBounds(period);

    const bank = await loadReconcileSide(store, bankSource, 'bank', from, to);
    const ledger = await loadReconcileSide(store, ledgerSource, 'ledger', from, to);

    const result = reconcile({ bank, ledger, tolerance });

    const runId = hashParts(bankSource, ledgerSource, period.from, period.to);
    await store.putReconcileRun({
      id: runId,
      bank_source: bankSource,
      ledger_source: ledgerSource,
      period: { from: period.from || null, to: period.to || null },
      summary: result.summary,
    });

    return result;
  };
}

function createPremiumHandlers(store) {
  return {
    reconcile: createReconcileHandler(store),
  };
}

async function syncSource(store, connector, period = {}) {
  const pulled = await connector.pull(period);
  const accounts = pulled.accounts || [];
  const statements = pulled.statements || [];
  const transactions = pulled.transactions || [];

  await Promise.all(accounts.map((a) => store.putAccount(a)));
  const persisted = await store.putTransactions(transactions);
  await Promise.all(statements.map((s) => store.putStatement(s)));
  const agg = await store.materializePositions({
    as_of: period.as_of || null,
    currency: period.currency || DEFAULT_CURRENCY,
  });

  return {
    accounts: accounts.length,
    statements: statements.length,
    persisted,
    position: agg.position,
  };
}

module.exports = {
  createOpenHandlers,
  createPremiumHandlers,
  createReconcileHandler,
  syncSource,
  buildAccountInputs,
};
