'use strict';

/**
 * YDB persistence and the idempotent sync store (M-persistence layer).
 *
 * There is no local Yandex Cloud / YDB emulator, so — exactly like the domain
 * core — the persistence LOGIC is decoupled from the driver behind a small,
 * injectable `backend` abstraction. The default `createMemoryBackend()` is an
 * in-process key/value store used by the unit tests; a real deployment plugs in a
 * YDB-backed implementation of the same four-method contract:
 *
 *   put(table, pk, row) -> row       // upsert by primary key (PUT)
 *   get(table, pk)      -> row|null
 *   delete(table, pk)   -> boolean
 *   scan(table)         -> row[]      // full-table scan (real driver uses indexes)
 *
 * All backend methods are async so the same store code runs unchanged over the
 * async YDB SDK.
 *
 * Tables (from the plan's Technical Details):
 *   accounts, transactions, statements, reconcile_runs, sync_state, positions.
 *
 * Idempotency: transactions are PUT by `id`; re-persisting the same operation is a
 * no-op replace, never a second row. When a source has no stable native id (so the
 * derived `id` is not unique), the content `dedup_key` is the safety net — a second
 * row carrying an already-seen `dedup_key` is reported as a `duplicate` and NOT
 * stored, so re-runs cannot double-count. `sync_state` cursors advance only AFTER a
 * batch is persisted.
 *
 * Money stays integer kopecks throughout; balances may be negative (overdraft).
 */

const { makeCashPosition, signedAmount, DEFAULT_CURRENCY } = require('./model');

const TABLES = [
  'accounts',
  'transactions',
  'statements',
  'reconcile_runs',
  'sync_state',
  'positions',
];

// Internal secondary index: dedup_key -> owning transaction id. Mirrors what a
// real YDB secondary index would provide; kept as its own "table" in the backend.
const DEDUP_INDEX = 'transactions_dedup';

/**
 * In-memory backend: `Map<table, Map<pk, row>>`. Deterministic and I/O-free, so it
 * is the default for unit tests. Async signatures match the real YDB driver.
 */
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

/** Composite primary keys, kept in one place so reads and writes never diverge. */
function statementKey(source, accountId, periodFrom, periodTo) {
  return `${source}:${accountId}:${periodFrom || ''}:${periodTo || ''}`;
}
function syncKey(source, accountId) {
  return `${source}:${accountId}`;
}
const POSITION_ACCT_PREFIX = 'acct:';
const POSITION_AGG_KEY = 'agg:latest';

/**
 * Compute an account's cleared balance from what is persisted.
 *
 * Prefers the freshest statement's `closing_balance` (the bank's own figure);
 * falls back to `opening_balance + Σ signed(posted transactions)` when no statement
 * is stored yet. Pending/hold lines never count toward cash.
 */
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

/**
 * Build a persistence store over a backend.
 * @param {object} [opts]
 * @param {object} [opts.backend] Backend implementing put/get/delete/scan; defaults to memory.
 */
function createStore(opts = {}) {
  const backend = opts.backend || createMemoryBackend();

  // ---- accounts -----------------------------------------------------------
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

  // ---- transactions (idempotent) -----------------------------------------
  /**
   * PUT one transaction by `id`. Returns the outcome so callers can count real
   * inserts vs. idempotent replays vs. duplicates:
   *   'inserted' — new row stored
   *   'replaced' — same `id` already present; upserted, not double-counted
   *   'duplicate'— a different `id` already owns this `dedup_key`; NOT stored
   */
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

  /** PUT a batch; returns `{inserted, replaced, duplicates, ids}`. */
  async function putTransactions(txns = []) {
    const out = { inserted: 0, replaced: 0, duplicates: 0, ids: [] };
    for (const tx of txns) {
      // eslint-disable-next-line no-await-in-loop
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

  // ---- statements ---------------------------------------------------------
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

  // ---- reconcile_runs -----------------------------------------------------
  async function putReconcileRun(run) {
    if (!run || !run.id) throw new Error('ydb: reconcile run needs an id');
    await backend.put('reconcile_runs', run.id, run);
    return run;
  }
  const getReconcileRun = (id) => backend.get('reconcile_runs', id);
  const listReconcileRuns = () => backend.scan('reconcile_runs');

  // ---- sync_state (per-source cursors) -----------------------------------
  const getSyncState = (source, accountId) => backend.get('sync_state', syncKey(source, accountId));

  /** Advance a source/account cursor. Call ONLY after the batch has persisted. */
  async function advanceSyncState(source, accountId, cursor, updatedAt) {
    const row = { source, account_id: accountId, cursor: cursor === undefined ? null : cursor, updated_at: updatedAt || null };
    await backend.put('sync_state', syncKey(source, accountId), row);
    return row;
  }

  /**
   * Persist a pulled batch, then advance the cursor — the durability order that
   * makes incremental sync safe: if persistence throws, the cursor is NOT moved,
   * so the same window is re-pulled and idempotency collapses the replay.
   * @returns {{persisted, cursor}} persisted = the putTransactions outcome.
   */
  async function syncBatch({ source, account_id, transactions = [], cursor, updated_at }) {
    const persisted = await putTransactions(transactions);
    const state = await advanceSyncState(source, account_id, cursor, updated_at);
    return { persisted, cursor: state.cursor };
  }

  // ---- positions (materialized cash position + forecast inputs) -----------
  /**
   * Recompute per-account balances from persisted accounts/statements/transactions,
   * store one `positions` row per account plus an aggregate row holding the full
   * `CashPosition` and the seed `forecast_inputs`, and return them.
   *
   * @param {object} [input]
   * @param {string} [input.as_of]     Snapshot point-in-time.
   * @param {string} [input.currency]  Report currency; default RUB.
   */
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
      // eslint-disable-next-line no-await-in-loop
      await backend.put('positions', `${POSITION_ACCT_PREFIX}${account.account_id}`, row);
      byAccount.push(row);
    }

    const position = makeCashPosition({ as_of: input.as_of || null, accounts: byAccount });

    // Forecast inputs: everything cashgap_forecast needs to seed a projection —
    // the current cash (per requested currency) plus per-account seeds. Scheduled
    // and recurring flows are layered on by the forecast caller.
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
    // accounts
    putAccount,
    getAccount,
    listAccounts,
    // transactions
    putTransaction,
    putTransactions,
    getTransaction,
    listTransactions,
    // statements
    putStatement,
    listStatements,
    // reconcile runs
    putReconcileRun,
    getReconcileRun,
    listReconcileRuns,
    // sync state
    getSyncState,
    advanceSyncState,
    syncBatch,
    // positions
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
