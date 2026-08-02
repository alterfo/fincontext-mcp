'use strict';

const { DEFAULT_CURRENCY } = require('./model');
const { cashgapForecast } = require('./forecast');
const { evaluateAlerts, isUnlocked } = require('./alerts');

const WATERMARK_ACCOUNT = '*';
const DEFAULT_LOOKBACK_DAYS = 30;

function isoMinusDays(iso, days) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms - days * 86400000).toISOString();
}

async function persistPulled(store, pulled) {
  const accounts = pulled.accounts || [];
  const statements = pulled.statements || [];
  const transactions = pulled.transactions || [];
  for (const account of accounts) {
    await store.putAccount(account);
  }
  const persisted = await store.putTransactions(transactions);
  for (const statement of statements) {
    await store.putStatement(statement);
  }
  return { accounts, statements, persisted };
}

async function syncOneSource(store, connector, now, from, currency) {
  const source = connector.source;
  const period = { from, to: now, as_of: now, currency };
  try {
    const pulled = await connector.pull(period);
    const { accounts, statements, persisted } = await persistPulled(store, pulled);
    for (const account of accounts) {
      await store.advanceSyncState(source, account.account_id, now, now);
    }
    await store.advanceSyncState(source, WATERMARK_ACCOUNT, now, now);
    return {
      source,
      ok: true,
      from,
      to: now,
      accounts: accounts.length,
      statements: statements.length,
      persisted,
    };
  } catch (err) {
    return { source, ok: false, from, to: now, error: err.message };
  }
}

async function incrementalSync(opts = {}) {
  const store = opts.store;
  if (!store) throw new Error('sync: store required');
  const now = opts.now;
  if (!now) throw new Error('sync: now (ISO timestamp) required');

  const currency = opts.currency || DEFAULT_CURRENCY;
  const lookbackDays = Number.isInteger(opts.lookback_days) ? opts.lookback_days : DEFAULT_LOOKBACK_DAYS;
  const sources = opts.sources || [];

  const perSource = [];
  for (const entry of sources) {
    const connector = entry.connector || entry;
    const prev = await store.getSyncState(connector.source, WATERMARK_ACCOUNT);
    const from = (prev && prev.cursor) || isoMinusDays(now, lookbackDays);
    perSource.push(await syncOneSource(store, connector, now, from, currency));
  }

  const agg = await store.materializePositions({ as_of: now, currency });

  const forecast = cashgapForecast({
    as_of: now,
    current_position: agg.forecast_inputs.current_position,
    currency,
    horizon_days: Number.isInteger(opts.horizon_days) ? opts.horizon_days : undefined,
    scenario: opts.scenario,
    include_recurring: opts.include_recurring,
    scheduled: opts.scheduled || [],
    recurring: opts.recurring || [],
  });

  const alerts = isUnlocked(opts.unlockedModules)
    ? evaluateAlerts({ position: agg.position, forecast, thresholds: opts.thresholds })
    : null;

  return {
    as_of: now,
    sources: perSource,
    position: agg.position,
    forecast_inputs: agg.forecast_inputs,
    forecast,
    alerts,
  };
}

module.exports = {
  incrementalSync,
  isoMinusDays,
  WATERMARK_ACCOUNT,
  DEFAULT_LOOKBACK_DAYS,
};
