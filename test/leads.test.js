'use strict';

const { recordLead, leadsConfig } = require('../src/leads');

describe('leads', () => {
  test('leadsConfig reads env with sane defaults', () => {
    const cfg = leadsConfig({});
    expect(cfg.table).toBe('leads');
    expect(cfg.region).toBe('ru-central1');
    expect(cfg.postboxEndpoint).toMatch(/postbox/);
    expect(cfg.keyId).toBe('');
  });

  test('recordLead is graceful and makes no network calls when unconfigured', async () => {
    const out = await recordLead({ email: 'seller@shop.ru', source: 'hero' }, {});
    expect(out.stored).toBe(false);
    expect(out.notified).toBe(false);
    expect(out.store_skipped).toBe('ydb_not_configured');
    expect(out.notify_skipped).toBe('email_not_configured');
    expect(out.errors).toEqual([]);
    expect(out.lead.email).toBe('seller@shop.ru');
    expect(out.lead.id).toMatch(/[0-9a-f-]{36}/);
  });
});
