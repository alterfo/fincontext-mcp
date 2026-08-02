'use strict';

const { DEFAULT_CURRENCY } = require('./model');

const MODULE = 'alerts';

const DEFAULT_THRESHOLDS = {
  low_balance_minor: 10000000,
  stale_after_sec: 86400,
};

function isUnlocked(unlockedModules) {
  return !Array.isArray(unlockedModules) || unlockedModules.includes(MODULE);
}

function accountAlerts(position, thresholds) {
  const out = [];
  for (const acct of position.by_account || []) {
    const currency = acct.currency || DEFAULT_CURRENCY;
    if (acct.balance < 0) {
      out.push({
        type: 'negative_balance',
        severity: 'critical',
        account_id: acct.account_id,
        source: acct.source || null,
        message: `Account ${acct.account_id} is overdrawn at ${acct.balance} kopecks (${currency}).`,
        data: { balance: acct.balance, currency },
      });
    } else if (acct.balance < thresholds.low_balance_minor) {
      out.push({
        type: 'low_balance',
        severity: 'warning',
        account_id: acct.account_id,
        source: acct.source || null,
        message: `Account ${acct.account_id} balance ${acct.balance} is below the ${thresholds.low_balance_minor} kopecks threshold (${currency}).`,
        data: { balance: acct.balance, threshold: thresholds.low_balance_minor, currency },
      });
    }
  }
  return out;
}

function forecastAlerts(forecast) {
  const out = [];
  if (forecast && forecast.gap && forecast.gap.will_occur) {
    out.push({
      type: 'cash_gap',
      severity: 'critical',
      account_id: null,
      source: null,
      message: `Projected cash gap on ${forecast.gap.first_gap_date}: deficit ${forecast.gap.deficit_amount} kopecks.`,
      data: {
        first_gap_date: forecast.gap.first_gap_date,
        min_balance: forecast.gap.min_balance,
        deficit_amount: forecast.gap.deficit_amount,
        horizon_days: forecast.horizon_days,
      },
    });
  }
  return out;
}

function evaluateAlerts(input = {}) {
  const position = input.position || { by_account: [], totals: {} };
  const forecast = input.forecast || null;
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(input.thresholds || {}) };
  return [...accountAlerts(position, thresholds), ...forecastAlerts(forecast)];
}

module.exports = {
  MODULE,
  DEFAULT_THRESHOLDS,
  evaluateAlerts,
  isUnlocked,
};
