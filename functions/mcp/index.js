'use strict';

const { handleMessage, makeError, ERROR } = require('../../src/mcp');
const { createStore } = require('../../src/ydb');
const { createOpenHandlers, createPremiumHandlers } = require('../../src/handlers');
const { unlockedModules } = require('../../src/license');
const { createDemoStore, demoMeta } = require('../../src/demo');
const { landingHtml } = require('../../src/landing');

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' };
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id',
};

const store = createStore();
const openHandlers = createOpenHandlers(store);
const premiumHandlers = createPremiumHandlers(store);

let demoState = null;

async function getDemo() {
  if (!demoState) {
    const demoStore = await createDemoStore();
    demoState = {
      handlers: {
        ...createOpenHandlers(demoStore),
        ...createPremiumHandlers(demoStore),
      },
      meta: demoMeta(),
    };
  }
  return demoState;
}

function demoDefaults(tool, meta) {
  switch (tool) {
    case 'get_cash_position':
      return { as_of: meta.forecast.as_of, currency: meta.currency };
    case 'check_payment':
      return { doc_number: '00003', amount: 9500000 };
    case 'reconcile':
      return {
        period: meta.reconcile.period,
        bank_source: meta.reconcile.bank_source,
        ledger_source: meta.reconcile.ledger_source,
      };
    case 'cashgap_forecast':
      return {
        as_of: meta.forecast.as_of,
        currency: meta.forecast.currency,
        horizon_days: meta.forecast.horizon_days,
        scenario: 'base',
        scheduled: meta.forecast.scheduled,
      };
    default:
      return null;
  }
}

async function runDemoTool(tool, args) {
  const demo = await getDemo();
  const defaults = demoDefaults(tool, demo.meta);
  if (!defaults) return null;
  const handler = demo.handlers[tool];
  if (typeof handler !== 'function') return null;
  const merged = { ...defaults, ...(args || {}) };
  const result = await handler(merged);
  return { tool, result };
}

function proKeyFromEvent(event) {
  const headers = (event && event.headers) || {};
  return (
    headers['X-FinContext-Pro-Key'] ||
    headers['x-fincontext-pro-key'] ||
    process.env.FINCONTEXT_PRO_KEY ||
    null
  );
}

function response(statusCode, bodyObj, extraHeaders) {
  return {
    statusCode,
    headers: { ...JSON_HEADERS, ...(extraHeaders || {}) },
    body: bodyObj === null ? '' : JSON.stringify(bodyObj),
  };
}

function htmlResponse(statusCode, html) {
  return { statusCode, headers: { ...HTML_HEADERS }, body: html };
}

function decodeBody(event) {
  if (!event || event.body == null) return '';
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, 'base64').toString('utf8');
  }
  return event.body;
}

function pathOf(event) {
  const raw =
    (event &&
      (event.path ||
        event.url ||
        (event.requestContext && (event.requestContext.path || event.requestContext.resourcePath)))) ||
    '/';
  const q = raw.indexOf('?');
  const clean = q >= 0 ? raw.slice(0, q) : raw;
  const trimmed = clean.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

function buildContext(event) {
  const modules = unlockedModules(proKeyFromEvent(event));
  return {
    store,
    handlers: { ...openHandlers, ...premiumHandlers },
    unlockedModules: modules,
  };
}

async function handleDemo(event) {
  let payload;
  try {
    const raw = decodeBody(event);
    payload = raw ? JSON.parse(raw) : {};
  } catch (_err) {
    return response(400, { error: 'Parse error: invalid JSON.' }, CORS_HEADERS);
  }
  const out = await runDemoTool(payload.tool, payload.args);
  if (!out) {
    return response(404, { error: `Unknown demo tool: ${payload.tool}` }, CORS_HEADERS);
  }
  return response(200, out, CORS_HEADERS);
}

async function handleJsonRpc(event) {
  let message;
  try {
    const raw = decodeBody(event);
    message = JSON.parse(raw);
  } catch (_err) {
    return response(200, makeError(null, ERROR.PARSE, 'Parse error: invalid JSON.'));
  }

  const ctx = buildContext(event);
  const result = await handleMessage(message, ctx);

  if (result === null) {
    return response(202, null);
  }
  return response(200, result);
}

module.exports.handler = async function handler(event, _context) {
  const method = (event && event.httpMethod) || 'POST';
  const path = pathOf(event);

  if (method === 'OPTIONS') {
    return response(204, null, CORS_HEADERS);
  }

  if (method === 'GET' && path === '/') {
    return htmlResponse(200, landingHtml());
  }

  if (path === '/demo' && (method === 'POST' || method === 'GET')) {
    return handleDemo(event);
  }

  if (method === 'POST') {
    return handleJsonRpc(event);
  }

  return response(405, makeError(null, ERROR.INVALID_REQUEST, 'Only POST is supported.'));
};
