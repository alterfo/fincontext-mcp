'use strict';

const { makeCashPosition, signedAmount, DEFAULT_CURRENCY } = require('./model');

const TABLES = [
  'accounts',
  'transactions',
  'statements',
  'reconcile_runs',
  'sync_state',
  'positions',
];

const DEDUP_INDEX = 'transactions_dedup';

function createMemoryBackend() {
  const tables = new Map();
  const tbl = (name) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name);
  };
  return {
    async put(table, pk, row) {
      tbl(table).set(String(pk), row);
      return row;
    },
    async get(table, pk) {
      const row = tbl(table).get(String(pk));
      return row === undefined ? null : row;
    },
    async delete(table, pk) {
      return tbl(table).delete(String(pk));
    },
    async scan(table) {
      return Array.from(tbl(table).values());
    },
  };
}

function statementKey(source, accountId, periodFrom, periodTo) {
  return `${source}:${accountId}:${periodFrom || ''}:${periodTo || ''}`;
}
function syncKey(source, accountId) {
  return `${source}:${accountId}`;
}
const POSITION_ACCT_PREFIX = 'acct:';
const POSITION_AGG_KEY = 'agg:latest';

function accountBalance(account, statements, transactions) {
  const stmts = statements
    .filter((s) => s.account_id === account.account_id && s.source === account.source)
    .sort((a, b) => String(b.period_to).localeCompare(String(a.period_to)));
  if (stmts.length > 0 && stmts[0].closing_balance !== undefined && stmts[0].closing_balance !== null) {
    return stmts[0].closing_balance;
  }
  const posted = transactions.filter(
    (tx) => tx.account_id === account.account_id && tx.source === account.source && tx.status === 'posted'
  );
  const opening = Number.isInteger(account.opening_balance) ? account.opening_balance : 0;
  return opening + posted.reduce((acc, tx) => acc + signedAmount(tx), 0);
}

function createStore(opts = {}) {
  const backend = opts.backend || createMemoryBackend();

  async function putAccount(account) {
    if (!account || !account.account_id) throw new Error('ydb: account.account_id required');
    const row = {
      account_id: account.account_id,
      source: account.source,
      bank: account.bank || account.source,
      title: account.title || null,
      currency: account.currency || DEFAULT_CURRENCY,
      opening_balance: Number.isInteger(account.opening_balance) ? account.opening_balance : 0,
      updated_at: account.updated_at || null,
    };
    await backend.put('accounts', account.account_id, row);
    return row;
  }
  const getAccount = (accountId) => backend.get('accounts', accountId);
  const listAccounts = () => backend.scan('accounts');

  async function putTransaction(tx) {
    if (!tx || !tx.id || !tx.dedup_key) throw new Error('ydb: transaction needs id and dedup_key');
    const existing = await backend.get('transactions', tx.id);
    if (existing) {
      await backend.put('transactions', tx.id, tx);
      return 'replaced';
    }
    const owner = await backend.get(DEDUP_INDEX, tx.dedup_key);
    if (owner && owner.id !== tx.id) {
      return 'duplicate';
    }
    await backend.put('transactions', tx.id, tx);
    await backend.put(DEDUP_INDEX, tx.dedup_key, { id: tx.id });
    return 'inserted';
  }

  async function putTransactions(txns = []) {
    const out = { inserted: 0, replaced: 0, duplicates: 0, ids: [] };
    for (const tx of txns) {
      const outcome = await putTransaction(tx);
      if (outcome === 'inserted') {
        out.inserted += 1;
        out.ids.push(tx.id);
      } else if (outcome === 'replaced') {
        out.replaced += 1;
      } else {
        out.duplicates += 1;
      }
    }
    return out;
  }

  const getTransaction = (id) => backend.get('transactions', id);

  async function listTransactions(filter = {}) {
    const rows = await backend.scan('transactions');
    return rows.filter((tx) => {
      if (filter.account_id && tx.account_id !== filter.account_id) return false;
      if (filter.source && tx.source !== filter.source) return false;
      if (filter.kind && tx.kind !== filter.kind) return false;
      if (filter.status && tx.status !== filter.status) return false;
      if (filter.from && String(tx.booked_at) < String(filter.from)) return false;
      if (filter.to && String(tx.booked_at) > String(filter.to)) return false;
      return true;
    });
  }

  async function putStatement(statement) {
    const pk = statementKey(
      statement.source,
      statement.account_id,
      statement.period_from,
      statement.period_to
    );
    await backend.put('statements', pk, statement);
    return statement;
  }
  const listStatements = () => backend.scan('statements');

  async function putReconcileRun(run) {
    if (!run || !run.id) throw new Error('ydb: reconcile run needs an id');
    await backend.put('reconcile_runs', run.id, run);
    return run;
  }
  const getReconcileRun = (id) => backend.get('reconcile_runs', id);
  const listReconcileRuns = () => backend.scan('reconcile_runs');

  const getSyncState = (source, accountId) => backend.get('sync_state', syncKey(source, accountId));

  async function advanceSyncState(source, accountId, cursor, updatedAt) {
    const row = { source, account_id: accountId, cursor: cursor === undefined ? null : cursor, updated_at: updatedAt || null };
    await backend.put('sync_state', syncKey(source, accountId), row);
    return row;
  }

  async function syncBatch({ source, account_id, transactions = [], cursor, updated_at }) {
    const persisted = await putTransactions(transactions);
    const state = await advanceSyncState(source, account_id, cursor, updated_at);
    return { persisted, cursor: state.cursor };
  }

  async function materializePositions(input = {}) {
    const currency = input.currency || DEFAULT_CURRENCY;
    const accounts = await listAccounts();
    const statements = await listStatements();
    const transactions = await backend.scan('transactions');

    const byAccount = [];
    for (const account of accounts) {
      const balance = accountBalance(account, statements, transactions);
      const row = {
        account_id: account.account_id,
        source: account.source,
        balance,
        currency: account.currency || currency,
        updated_at: account.updated_at || null,
        as_of: input.as_of || null,
      };
      await backend.put('positions', `${POSITION_ACCT_PREFIX}${account.account_id}`, row);
      byAccount.push(row);
    }

    const position = makeCashPosition({ as_of: input.as_of || null, accounts: byAccount });

    const forecastInputs = {
      as_of: input.as_of || null,
      currency,
      current_position: position.totals[currency] || 0,
      by_account: byAccount.map((a) => ({
        account_id: a.account_id,
        current_position: a.balance,
        currency: a.currency,
      })),
    };

    const agg = { as_of: input.as_of || null, position, forecast_inputs: forecastInputs };
    await backend.put('positions', POSITION_AGG_KEY, agg);
    return agg;
  }

  const getPosition = (accountId) => backend.get('positions', `${POSITION_ACCT_PREFIX}${accountId}`);
  async function getCashPosition() {
    const agg = await backend.get('positions', POSITION_AGG_KEY);
    return agg ? agg.position : null;
  }
  async function getForecastInputs() {
    const agg = await backend.get('positions', POSITION_AGG_KEY);
    return agg ? agg.forecast_inputs : null;
  }

  return {
    backend,
    putAccount,
    getAccount,
    listAccounts,
    putTransaction,
    putTransactions,
    getTransaction,
    listTransactions,
    putStatement,
    listStatements,
    putReconcileRun,
    getReconcileRun,
    listReconcileRuns,
    getSyncState,
    advanceSyncState,
    syncBatch,
    materializePositions,
    getPosition,
    getCashPosition,
    getForecastInputs,
  };
}

module.exports = {
  TABLES,
  createStore,
  createMemoryBackend,
  accountBalance,
  statementKey,
  syncKey,
};
