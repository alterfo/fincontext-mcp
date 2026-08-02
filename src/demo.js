'use strict';

const data = require('./demo-data.json');
const { createStore } = require('./ydb');

async function createDemoStore() {
  const store = createStore();
  await store.putAccount(data.account);
  await store.putStatement(data.statement);
  await store.putTransactions(data.transactions);
  return store;
}

function demoMeta() {
  return {
    scenario: data.scenario,
    currency: data.currency,
    reconcile: data.reconcile,
    forecast: data.forecast,
    generated_at: data.generated_at,
  };
}

module.exports = { createDemoStore, demoMeta, DEMO_DATA: data };
