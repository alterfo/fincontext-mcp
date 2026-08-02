'use strict';

/**
 * Cash-gap forecast engine (premium tool `cashgap_forecast`, module `forecast`).
 *
 * Pure, I/O-free projection over integer kopeck flows. Given a starting cash
 * position and known future movements — one-off `scheduled` flows and periodic
 * `recurring` rules — it walks day-by-day over `horizon_days`, accumulating a
 * projected balance and flagging the first day (if any) the balance goes
 * negative (a cash gap).
 *
 * Determinism: no wall-clock, no RNG. Dates are handled as UTC calendar days
 * (`YYYY-MM-DD`). Money is ALWAYS integer minor units (kopecks); the projected
 * balance may be negative (an overdraft / gap), but individual flow `amount`s are
 * non-negative with the sign carried by `direction` (`in`|`out`).
 *
 * Two scenarios:
 *   - `base`         — flows land as scheduled at face value.
 *   - `conservative` — inflows are stress-tested: delayed by `inflow_delay_days`
 *                      and haircut by `inflow_haircut_pct` (money arrives later and
 *                      short). Outflows are unchanged. Every adjustment is recorded
 *                      in the returned `assumptions` list.
 *
 * @param {object} input
 * @param {string}  input.as_of              Projection start day (`YYYY-MM-DD` or ISO); day-0 balance anchor.
 * @param {number}  [input.current_position] Starting cash in kopecks (integer, may be negative). Default 0.
 * @param {string}  [input.currency]         ISO-4217; default `RUB`.
 * @param {number}  [input.horizon_days=30]  Days to project forward (1..365).
 * @param {string}  [input.scenario="base"]  `base` | `conservative`.
 * @param {boolean} [input.include_recurring=true] Whether to expand `recurring` rules.
 * @param {Array}   [input.scheduled]        One-off flows `[{date, direction, amount, label?}]`.
 * @param {Array}   [input.recurring]        Periodic rules `[{direction, amount, label?, interval_days?, start?, day_of_month?}]`.
 * @param {object}  [input.scenario_params]  Override `{inflow_delay_days, inflow_haircut_pct}`.
 *
 * @returns {{horizon_days, scenario, current_position:{amount,currency},
 *            daily:Array<{date, projected_balance, inflows, outflows}>,
 *            gap:{will_occur, first_gap_date?, min_balance, deficit_amount?},
 *            assumptions:string[]}}
 */

const { DEFAULT_CURRENCY } = require('./model');

const DEFAULT_HORIZON = 30;
const MAX_HORIZON = 365;

const DEFAULT_SCENARIO_PARAMS = {
  inflow_delay_days: 3,
  inflow_haircut_pct: 10,
};

/** Reduce a `YYYY-MM-DD` or ISO date-time to its `YYYY-MM-DD` calendar day (null when unparseable). */
function toDateOnly(value) {
  if (!value) return null;
  const day = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/** Add `n` whole days to a `YYYY-MM-DD` day, returning a `YYYY-MM-DD` day (UTC). */
function addDaysDate(dateOnly, n) {
  const [y, m, d] = dateOnly.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + n * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Signed whole-day distance `b - a` between two `YYYY-MM-DD` days. */
function dayIndexBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/** Calendar day-of-month (1..31) of a `YYYY-MM-DD` day. */
function dayOfMonth(dateOnly) {
  return Number(dateOnly.split('-')[2]);
}

/**
 * Expand a recurring rule into the day-indices (1..horizon) it fires on.
 * Supports `interval_days` (every N days, first at `start` or `as_of + interval_days`)
 * and `day_of_month` (that calendar day each month in range).
 */
function expandRecurring(rule, start, horizon) {
  const days = [];
  if (rule.interval_days && rule.interval_days > 0) {
    const step = rule.interval_days;
    let first = rule.start ? dayIndexBetween(start, toDateOnly(rule.start)) : step;
    if (first < 1) {
      // Advance to the first occurrence inside the horizon window.
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

  // Start day anchors day-0. Fall back to today (UTC) only when omitted.
  const start = toDateOnly(input.as_of) || new Date().toISOString().slice(0, 10);

  // 1) Collect raw flow events as {day, direction, amount}.
  const events = [];
  for (const f of input.scheduled || []) {
    const day = dayIndexBetween(start, toDateOnly(f.date));
    if (day === null || Number.isNaN(day)) continue;
    events.push({ day, direction: f.direction, amount: f.amount });
  }
  if (includeRecurring) {
    for (const r of input.recurring || []) {
      for (const day of expandRecurring(r, start, horizon)) {
        events.push({ day, direction: r.direction, amount: r.amount });
      }
    }
  }

  // 2) Apply the scenario stress to inflows (conservative delays + haircuts them).
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

  // 3) Bucket flows per projection day (events outside 1..horizon are dropped).
  const buckets = new Map();
  for (const e of adjusted) {
    if (e.day < 1 || e.day > horizon) continue;
    const b = buckets.get(e.day) || { inflows: 0, outflows: 0 };
    if (e.direction === 'in') b.inflows += e.amount;
    else b.outflows += e.amount;
    buckets.set(e.day, b);
  }

  // 4) Walk the horizon, accumulating the running projected balance.
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
    gap.deficit_amount = -minBalance; // largest shortfall, positive kopecks
  }

  // 5) Explicit, human-readable assumptions (honesty about what drove the number).
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
