'use strict';

const { cashgapForecast, expandRecurring, addDaysDate } = require('../src/forecast');

describe('cashgap_forecast — projection math', () => {
  test('daily array spans exactly horizon_days with contiguous dates', () => {
    const out = cashgapForecast({ as_of: '2026-01-01', current_position: 100000, horizon_days: 5 });
    expect(out.horizon_days).toBe(5);
    expect(out.daily).toHaveLength(5);
    expect(out.daily.map((d) => d.date)).toEqual([
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
      '2026-01-05',
      '2026-01-06',
    ]);
  });

  test('no flows: balance stays flat at the starting position', () => {
    const out = cashgapForecast({ as_of: '2026-01-01', current_position: 500000, horizon_days: 3 });
    for (const d of out.daily) {
      expect(d.projected_balance).toBe(500000);
      expect(d.inflows).toBe(0);
      expect(d.outflows).toBe(0);
    }
    expect(out.gap.will_occur).toBe(false);
    expect(out.gap.min_balance).toBe(500000);
  });

  test('scheduled inflows/outflows accumulate into the running balance', () => {
    const out = cashgapForecast({
      as_of: '2026-01-01',
      current_position: 100000,
      horizon_days: 4,
      scheduled: [
        { date: '2026-01-02', direction: 'out', amount: 30000, label: 'rent' },
        { date: '2026-01-03', direction: 'in', amount: 50000, label: 'invoice' },
        { date: '2026-01-04', direction: 'out', amount: 20000 },
      ],
    });
    const balances = out.daily.map((d) => d.projected_balance);
    // 100000 -30000 => 70000; +50000 => 120000; -20000 => 100000; flat => 100000
    expect(balances).toEqual([70000, 120000, 100000, 100000]);
    expect(out.daily[0].outflows).toBe(30000);
    expect(out.daily[1].inflows).toBe(50000);
  });

  test('scheduled flows outside the horizon window are ignored', () => {
    const out = cashgapForecast({
      as_of: '2026-01-01',
      current_position: 100000,
      horizon_days: 2,
      scheduled: [
        { date: '2025-12-31', direction: 'out', amount: 999999 }, // before start
        { date: '2026-02-01', direction: 'out', amount: 999999 }, // past horizon
      ],
    });
    expect(out.daily.every((d) => d.projected_balance === 100000)).toBe(true);
  });
});

describe('cashgap_forecast — gap detection', () => {
  test('flags the first day the balance goes negative with the deepest deficit', () => {
    const out = cashgapForecast({
      as_of: '2026-03-01',
      current_position: 40000,
      horizon_days: 4,
      scheduled: [
        { date: '2026-03-02', direction: 'out', amount: 50000 }, // -10000 (gap)
        { date: '2026-03-03', direction: 'out', amount: 30000 }, // -40000 (deepest)
        { date: '2026-03-04', direction: 'in', amount: 100000 }, // +60000 (recovers)
      ],
    });
    expect(out.gap.will_occur).toBe(true);
    expect(out.gap.first_gap_date).toBe('2026-03-02');
    expect(out.gap.min_balance).toBe(-40000);
    expect(out.gap.deficit_amount).toBe(40000);
  });

  test('an already-negative starting position is a gap at as_of', () => {
    const out = cashgapForecast({ as_of: '2026-03-01', current_position: -5000, horizon_days: 2 });
    expect(out.gap.will_occur).toBe(true);
    expect(out.gap.first_gap_date).toBe('2026-03-01');
    expect(out.gap.min_balance).toBe(-5000);
    expect(out.gap.deficit_amount).toBe(5000);
  });

  test('no gap: first_gap_date and deficit_amount are omitted', () => {
    const out = cashgapForecast({ as_of: '2026-03-01', current_position: 10000, horizon_days: 2 });
    expect(out.gap.will_occur).toBe(false);
    expect(out.gap).not.toHaveProperty('first_gap_date');
    expect(out.gap).not.toHaveProperty('deficit_amount');
  });
});

describe('cashgap_forecast — recurring flows', () => {
  test('interval_days rules fire every N days within the horizon', () => {
    const days = expandRecurring({ direction: 'out', amount: 1, interval_days: 7 }, '2026-01-01', 30);
    expect(days).toEqual([7, 14, 21, 28]);
  });

  test('day_of_month rules fire on that calendar day each month', () => {
    const days = expandRecurring({ direction: 'in', amount: 1, day_of_month: 10 }, '2026-01-01', 70);
    // 2026-01-10 (d=9), 2026-02-10 (d=40), 2026-03-10 (d=68)
    expect(days).toEqual([9, 40, 68]);
  });

  test('include_recurring=false drops recurring flows from the projection', () => {
    const base = {
      as_of: '2026-01-01',
      current_position: 100000,
      horizon_days: 14,
      recurring: [{ direction: 'out', amount: 10000, interval_days: 7 }],
    };
    const withRec = cashgapForecast(base);
    const withoutRec = cashgapForecast({ ...base, include_recurring: false });
    // Two payments of 10000 land on day 7 and 14.
    expect(withRec.daily[13].projected_balance).toBe(80000);
    expect(withoutRec.daily[13].projected_balance).toBe(100000);
  });
});

describe('cashgap_forecast — scenarios', () => {
  const scheduled = [{ date: '2026-01-05', direction: 'in', amount: 100000, label: 'big invoice' }];

  test('base scenario lands the inflow on its date at full value', () => {
    const out = cashgapForecast({
      as_of: '2026-01-01',
      current_position: 0,
      horizon_days: 10,
      scenario: 'base',
      scheduled,
    });
    const day4 = out.daily.find((d) => d.date === '2026-01-05');
    expect(day4.inflows).toBe(100000);
    expect(day4.projected_balance).toBe(100000);
  });

  test('conservative scenario delays and haircuts the inflow', () => {
    const out = cashgapForecast({
      as_of: '2026-01-01',
      current_position: 0,
      horizon_days: 10,
      scenario: 'conservative',
      scheduled,
    });
    // Default: +3 days delay, 10% haircut => lands 2026-01-08 at 90000.
    const original = out.daily.find((d) => d.date === '2026-01-05');
    const delayed = out.daily.find((d) => d.date === '2026-01-08');
    expect(original.inflows).toBe(0);
    expect(delayed.inflows).toBe(90000);
    expect(delayed.projected_balance).toBe(90000);
    expect(out.assumptions.some((a) => /Conservative scenario/.test(a))).toBe(true);
  });

  test('conservative stress can turn a healthy base projection into a gap', () => {
    const common = {
      as_of: '2026-01-01',
      current_position: 20000,
      horizon_days: 6,
      scheduled: [
        { date: '2026-01-03', direction: 'in', amount: 40000 }, // covers the outflow in base
        { date: '2026-01-04', direction: 'out', amount: 50000 },
      ],
    };
    const base = cashgapForecast({ ...common, scenario: 'base' });
    const cons = cashgapForecast({ ...common, scenario: 'conservative' });
    expect(base.gap.will_occur).toBe(false);
    // Inflow slips past the outflow day and shrinks => balance dips negative.
    expect(cons.gap.will_occur).toBe(true);
    expect(cons.gap.first_gap_date).toBe('2026-01-04');
  });

  test('custom scenario_params override the default delay/haircut', () => {
    const out = cashgapForecast({
      as_of: '2026-01-01',
      current_position: 0,
      horizon_days: 10,
      scenario: 'conservative',
      scenario_params: { inflow_delay_days: 1, inflow_haircut_pct: 50 },
      scheduled,
    });
    const delayed = out.daily.find((d) => d.date === '2026-01-06');
    expect(delayed.inflows).toBe(50000);
  });
});

describe('cashgap_forecast — output contract & determinism', () => {
  test('carries current_position, assumptions, and clamps horizon', () => {
    const out = cashgapForecast({ as_of: '2026-01-01', current_position: 12345, horizon_days: 999 });
    expect(out.current_position).toEqual({ amount: 12345, currency: 'RUB' });
    expect(out.horizon_days).toBe(365);
    expect(Array.isArray(out.assumptions)).toBe(true);
    expect(out.assumptions.length).toBeGreaterThan(0);
  });

  test('defaults: horizon 30, base scenario, RUB, zero starting position', () => {
    const out = cashgapForecast({ as_of: '2026-01-01' });
    expect(out.horizon_days).toBe(30);
    expect(out.scenario).toBe('base');
    expect(out.current_position).toEqual({ amount: 0, currency: 'RUB' });
    expect(out.daily).toHaveLength(30);
  });

  test('same input yields identical output (pure/deterministic)', () => {
    const input = {
      as_of: '2026-01-01',
      current_position: 100000,
      horizon_days: 20,
      scenario: 'conservative',
      recurring: [{ direction: 'out', amount: 5000, interval_days: 5 }],
      scheduled: [{ date: '2026-01-10', direction: 'in', amount: 30000 }],
    };
    expect(cashgapForecast(input)).toEqual(cashgapForecast(input));
  });

  test('addDaysDate handles month boundaries', () => {
    expect(addDaysDate('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDaysDate('2026-02-28', 1)).toBe('2026-03-01');
  });
});
