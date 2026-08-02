'use strict';

const { createDemoStore, demoMeta } = require('../src/demo');
const { createOpenHandlers, createPremiumHandlers } = require('../src/handlers');

describe('frozen demo fixture', () => {
  let open;
  let prem;
  let meta;

  beforeAll(async () => {
    const store = await createDemoStore();
    open = createOpenHandlers(store);
    prem = createPremiumHandlers(store);
    meta = demoMeta();
  });

  test('cash position totals the starting balance', async () => {
    const pos = await open.get_cash_position({ as_of: meta.forecast.as_of });
    expect(pos.total.amount).toBe(45000000);
    expect(pos.total.currency).toBe('RUB');
  });

  test('reconcile yields six matches and one of each designed exception', async () => {
    const rec = await prem.reconcile({
      period: meta.reconcile.period,
      bank_source: 'tochka',
      ledger_source: 'moysklad',
    });
    expect(rec.summary.matched).toBe(6);
    expect(rec.summary.partial).toBe(1);
    expect(rec.summary.unmatched_bank).toBe(1);
    expect(rec.summary.unmatched_ledger).toBe(1);
    const types = rec.exceptions.map((e) => e.type).sort();
    expect(types).toEqual(['missing_in_bank', 'missing_in_ledger', 'partial_payment']);
  });

  test('cashgap forecast predicts the gap on the salary date', async () => {
    const fc = await prem.cashgap_forecast({
      as_of: meta.forecast.as_of,
      horizon_days: meta.forecast.horizon_days,
      scenario: 'base',
      scheduled: meta.forecast.scheduled,
    });
    expect(fc.gap.will_occur).toBe(true);
    expect(fc.gap.first_gap_date).toBe('2026-08-12');
    expect(fc.gap.deficit_amount).toBe(25000000);
  });
});
