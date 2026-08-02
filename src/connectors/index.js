'use strict';

const OPEN = {
  tochka: () => require('./tochka').createTochkaConnector,
  moysklad: () => require('./moysklad').createMoyskladConnector,
};

const PREMIUM = {
  kontur: { module: 'connectors:kontur', factory: 'createKonturConnector', file: './kontur' },
  '1c': { module: 'connectors:1c', factory: 'create1cConnector', file: './1c' },
};

function isPremiumConnector(source) {
  return Object.prototype.hasOwnProperty.call(PREMIUM, source);
}

function connectorModule(source) {
  const entry = PREMIUM[source];
  return entry ? entry.module : null;
}

function loadConnectorFactory(source, opts = {}) {
  if (OPEN[source]) return OPEN[source]();

  const entry = PREMIUM[source];
  if (!entry) {
    const err = new Error(`unknown connector source: ${source}`);
    err.code = 'UNKNOWN_CONNECTOR';
    throw err;
  }

  const unlocked = Array.isArray(opts.unlockedModules) ? opts.unlockedModules : [];
  if (!unlocked.includes(entry.module)) {
    const err = new Error(`connector "${source}" requires module ${entry.module}`);
    err.code = 'UPGRADE_REQUIRED';
    err.module = entry.module;
    throw err;
  }

  const loaded = require(entry.file);
  return loaded[entry.factory];
}

module.exports = {
  OPEN,
  PREMIUM,
  isPremiumConnector,
  connectorModule,
  loadConnectorFactory,
};
