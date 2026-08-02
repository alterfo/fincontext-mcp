'use strict';

const { createStore } = require('../../src/ydb');
const { createLockbox } = require('../../src/lockbox');
const { createTochkaConnector } = require('../../src/connectors/tochka');
const { createMoyskladConnector } = require('../../src/connectors/moysklad');
const { incrementalSync } = require('../../src/sync');

const store = createStore();

const CONNECTOR_FACTORIES = {
  tochka: (token) =>
    createTochkaConnector({ token, baseUrl: process.env.TOCHKA_BASE_URL || undefined }),
  moysklad: (token) =>
    createMoyskladConnector({ token, baseUrl: process.env.MOYSKLAD_BASE_URL || undefined }),
};

async function resolveSources(lockbox, factories = CONNECTOR_FACTORIES) {
  const sources = [];
  for (const [source, factory] of Object.entries(factories)) {
    let token = null;
    try {
      token = await lockbox.getToken(source);
    } catch (_err) {
      token = null;
    }
    if (token) sources.push({ connector: factory(token) });
  }
  return sources;
}

module.exports.handler = async function handler(_event, _context) {
  const lockbox = createLockbox();
  const sources = await resolveSources(lockbox);
  const now = new Date().toISOString();

  const result = await incrementalSync({
    store,
    sources,
    now,
    currency: process.env.REPORT_CURRENCY || undefined,
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      as_of: result.as_of,
      sources: result.sources.map((s) => ({
        source: s.source,
        ok: s.ok,
        persisted: s.persisted || null,
        error: s.error || null,
      })),
      totals: result.position.totals,
      gap: result.forecast.gap,
      alerts: result.alerts,
    }),
  };
};

module.exports.resolveSources = resolveSources;
module.exports.CONNECTOR_FACTORIES = CONNECTOR_FACTORIES;
module.exports.store = store;
