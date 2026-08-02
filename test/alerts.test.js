'use strict';

const { evaluateAlerts, isUnlocked, DEFAULT_THRESHOLDS } = require('../src/alerts');

const position = (accounts) => ({
  as_of: '2026-08-02T00:00:00.000Z',
  by_account: accounts,
  totals: {},
});

describe('evaluateAlerts', () => {
  test('flags an overdrawn account as critical negative_balance', () => {
    const alerts = evaluateAlerts({
      position: position([{ account_id: 'a1', source: 'tochka', balance: -500, currency: 'RUB' }]),
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: 'negative_balance', severity: 'critical', account_id: 'a1' });
  });

  test('flags a positive-but-thin balance as low_balance warning', () => {
    const alerts = evaluateAlerts({
      position: position([{ account_id: 'a1', source: 'tochka', balance: 5000, currency: 'RUB' }]),
      thresholds: { low_balance_minor: 100000 },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: 'low_balance', severity: 'warning' });
    expect(alerts[0].data.threshold).toBe(100000);
  });

  test('does not alert when balance is at or above the threshold', () => {
    const alerts = evaluateAlerts({
      position: position([{ account_id: 'a1', source: 'tochka', balance: 100000, currency: 'RUB' }]),
      thresholds: { low_balance_minor: 100000 },
    });
    expect(alerts).toHaveLength(0);
  });

  test('emits a cash_gap alert from a forecast that projects a gap', () => {
    const forecast = {
      horizon_days: 30,
      gap: { will_occur: true, first_gap_date: '2026-08-20', min_balance: -12345, deficit_amount: 12345 },
    };
    const alerts = evaluateAlerts({
      position: position([{ account_id: 'a1', source: 'tochka', balance: 100000000, currency: 'RUB' }]),
      forecast,
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: 'cash_gap', severity: 'critical' });
    expect(alerts[0].data.deficit_amount).toBe(12345);
    expect(alerts[0].data.first_gap_date).toBe('2026-08-20');
  });

  test('no cash_gap alert when the forecast projects no gap', () => {
    const forecast = { horizon_days: 30, gap: { will_occur: false, min_balance: 4200 } };
    const alerts = evaluateAlerts({
      position: position([{ account_id: 'a1', source: 'tochka', balance: 100000000, currency: 'RUB' }]),
      forecast,
    });
    expect(alerts).toHaveLength(0);
  });

  test('default low-balance threshold is applied when none is supplied', () => {
    const alerts = evaluateAlerts({
      position: position([{ account_id: 'a1', source: 'tochka', balance: DEFAULT_THRESHOLDS.low_balance_minor - 1, currency: 'RUB' }]),
    });
    expect(alerts.map((a) => a.type)).toContain('low_balance');
  });
});

describe('isUnlocked', () => {
  test('null modules means dev mode: alerts unlocked', () => {
    expect(isUnlocked(undefined)).toBe(true);
    expect(isUnlocked(null)).toBe(true);
  });

  test('respects an explicit module set', () => {
    expect(isUnlocked(['alerts'])).toBe(true);
    expect(isUnlocked(['reconcile'])).toBe(false);
    expect(isUnlocked([])).toBe(false);
  });
});
