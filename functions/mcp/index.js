'use strict';

const { handleMessage, makeError, ERROR } = require('../../src/mcp');
const { createStore } = require('../../src/ydb');
const { createOpenHandlers, createPremiumHandlers } = require('../../src/handlers');
const { unlockedModules } = require('../../src/license');

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const store = createStore();
const openHandlers = createOpenHandlers(store);
const premiumHandlers = createPremiumHandlers(store);

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

function decodeBody(event) {
  if (!event || event.body == null) return '';
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, 'base64').toString('utf8');
  }
  return event.body;
}

function buildContext(event) {
  const modules = unlockedModules(proKeyFromEvent(event));
  return {
    store,
    handlers: { ...openHandlers, ...premiumHandlers },
    unlockedModules: modules,
  };
}

module.exports.handler = async function handler(event, _context) {
  const method = (event && event.httpMethod) || 'POST';

  if (method === 'OPTIONS') {
    return response(204, null, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id',
    });
  }

  if (method !== 'POST') {
    return response(405, makeError(null, ERROR.INVALID_REQUEST, 'Only POST is supported.'));
  }

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
};
