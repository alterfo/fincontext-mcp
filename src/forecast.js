'use strict';

const { DEFAULT_CURRENCY } = require('./model');

const DEFAULT_HORIZON = 30;
const MAX_HORIZON = 365;

const DEFAULT_SCENARIO_PARAMS = {
  inflow_delay_days: 3,
  inflow_haircut_pct: 10,
};

function toDateOnly(value) {
  if (!value) return null;
  const day = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function addDaysDate(dateOnly, n) {
  const [y, m, d] = dateOnly.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + n * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

function dayIndexBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

function dayOfMonth(dateOnly) {
  return Number(dateOnly.split('-')[2]);
}

function expandRecurring(rule, start, horizon) {
  const days = [];
  if (rule.interval_days && rule.interval_days > 0) {
    const step = rule.interval_days;
    const ruleStart = rule.start ? toDateOnly(rule.start) : null;
    let first = ruleStart ? dayIndexBetween(start, ruleStart) : step;
    if (first < 1) {
      first += Math.ceil((1 - first) / step) * step;
    }
    for (let d = first; d <= horizon; d += step) {
      if (d >= 1) days.push(d);
    }
  } else if (rule.day_of_month) {
    for (let d = 1; d <= horizon; d += 1) {
      if (dayOfMonth(addDaysDate(start, d)) === rule.day_of_month) days.push(d);
    }
  }
  return days;
}

function cashgapForecast(input = {}) {
  const horizon = Math.min(
    MAX_HORIZON,
    Number.isInteger(input.horizon_days) && input.horizon_days > 0 ? input.horizon_days : DEFAULT_HORIZON
  );
  const scenario = input.scenario === 'conservative' ? 'conservative' : 'base';
  const includeRecurring = input.include_recurring !== false;
  const currency = input.currency || DEFAULT_CURRENCY;
  const opening = Number.isInteger(input.current_position) ? input.current_position : 0;
  const params = { ...DEFAULT_SCENARIO_PARAMS, ...(input.scenario_params || {}) };

  const start = toDateOnly(input.as_of) || new Date().toISOString().slice(0, 10);

  const events = [];
  for (const f of input.scheduled || []) {
    const fd = toDateOnly(f.date);
    if (!fd) continue;
    const day = dayIndexBetween(start, fd);
    if (Number.isNaN(day)) continue;
    events.push({ day, direction: f.direction, amount: f.amount });
  }
  if (includeRecurring) {
    for (const r of input.recurring || []) {
      for (const day of expandRecurring(r, start, horizon)) {
        events.push({ day, direction: r.direction, amount: r.amount });
      }
    }
  }

  const adjusted = events.map((e) => {
    if (scenario === 'conservative' && e.direction === 'in') {
      return {
        day: e.day + params.inflow_delay_days,
        direction: e.direction,
        amount: Math.floor((e.amount * (100 - params.inflow_haircut_pct)) / 100),
      };
    }
    return e;
  });

  const buckets = new Map();
  for (const e of adjusted) {
    if (e.day < 1 || e.day > horizon) continue;
    const b = buckets.get(e.day) || { inflows: 0, outflows: 0 };
    if (e.direction === 'in') b.inflows += e.amount;
    else b.outflows += e.amount;
    buckets.set(e.day, b);
  }

  let running = opening;
  let minBalance = opening;
  let firstGapDate = opening < 0 ? start : null;
  const daily = [];
  for (let d = 1; d <= horizon; d += 1) {
    const b = buckets.get(d) || { inflows: 0, outflows: 0 };
    running = running + b.inflows - b.outflows;
    const date = addDaysDate(start, d);
    daily.push({ date, projected_balance: running, inflows: b.inflows, outflows: b.outflows });
    if (running < minBalance) minBalance = running;
    if (running < 0 && firstGapDate === null) firstGapDate = date;
  }

  const willOccur = minBalance < 0;
  const gap = { will_occur: willOccur, min_balance: minBalance };
  if (willOccur) {
    gap.first_gap_date = firstGapDate;
    gap.deficit_amount = -minBalance;
  }

  const assumptions = [
    `Projected ${horizon} day(s) forward from ${start}.`,
    `Starting cash position: ${opening} kopecks (${currency}).`,
    includeRecurring
      ? 'Recurring inflows/outflows included per their rules.'
      : 'Recurring flows excluded; only one-off scheduled flows projected.',
  ];
  if (scenario === 'conservative') {
    assumptions.push(
      `Conservative scenario: inflows delayed by ${params.inflow_delay_days} day(s) and reduced by ${params.inflow_haircut_pct}%.`,
      'Outflows are not discounted or accelerated.'
    );
  } else {
    assumptions.push('Base scenario: flows land as scheduled at face value.');
  }

  return {
    horizon_days: horizon,
    scenario,
    current_position: { amount: opening, currency },
    daily,
    gap,
    assumptions,
  };
}

module.exports = {
  cashgapForecast,
  expandRecurring,
  addDaysDate,
  dayIndexBetween,
};
