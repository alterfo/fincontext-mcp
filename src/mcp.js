'use strict';

/**
 * FinContext MCP server core: tool registration and JSON-RPC 2.0 routing.
 *
 * This module is pure/transport-agnostic. The FaaS handler in
 * `functions/mcp/index.js` adapts an HTTP request into JSON-RPC message(s) and
 * feeds them to `handleMessage`/`handleRequest` here. Keeping routing decoupled
 * from the Yandex Cloud handler lets us test it with plain Jest (there is no
 * local Yandex Cloud emulator).
 */

const { TOOLS, toListEntry, getTool } = require('./tools');

const JSONRPC_VERSION = '2.0';
const PROTOCOL_VERSION = '2025-06-18';

const SERVER_INFO = {
  name: 'fincontext-mcp',
  version: '0.1.0',
};

// JSON-RPC error codes (spec-defined range plus one app-level code).
const ERROR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  // Application-level: premium tool called without the unlocking module.
  UPGRADE_REQUIRED: -32001,
};

function makeError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: JSONRPC_VERSION, id: id ?? null, error };
}

function makeResult(id, result) {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

/**
 * Which tools are visible/callable for this request.
 *
 * Task 1 has no license layer yet, so all tools (including premium) are
 * advertised. `unlockedModules` is threaded through now so Task 9 can gate
 * without reshaping the router. When provided (an array), premium tools are
 * filtered to those whose `module` is unlocked.
 */
function visibleTools(unlockedModules) {
  if (!Array.isArray(unlockedModules)) return TOOLS;
  return TOOLS.filter((t) => !t.premium || unlockedModules.includes(t.module));
}

async function handleInitialize(id) {
  return makeResult(id, {
    protocolVersion: PROTOCOL_VERSION,
    serverInfo: SERVER_INFO,
    capabilities: {
      tools: { listChanged: false },
    },
  });
}

async function handleToolsList(id, context) {
  const tools = visibleTools(context.unlockedModules).map(toListEntry);
  return makeResult(id, { tools });
}

async function handleToolsCall(id, params, context) {
  const name = params && params.name;
  const tool = getTool(name);
  if (!tool) {
    return makeError(id, ERROR.METHOD_NOT_FOUND, `Unknown tool: ${name}`);
  }

  // Premium gating hook — inert until Task 9 wires real license modules.
  if (
    tool.premium &&
    Array.isArray(context.unlockedModules) &&
    !context.unlockedModules.includes(tool.module)
  ) {
    return makeError(id, ERROR.UPGRADE_REQUIRED, `Tool "${name}" requires a Pro-key.`, {
      upgrade_url: context.upgradeUrl || 'https://fincontext.dev/pro',
    });
  }

  const handler = context.handlers && context.handlers[name];
  if (typeof handler !== 'function') {
    // Skeleton stage: tool is registered but its domain logic is not wired yet.
    return makeError(id, ERROR.INTERNAL, `Tool "${name}" is not implemented yet.`, {
      not_implemented: true,
    });
  }

  const output = await handler((params && params.arguments) || {}, context);
  return makeResult(id, output);
}

/**
 * Route a single well-formed JSON-RPC request object to its handler.
 * Returns a response object, or `null` for notifications (no `id`).
 */
async function handleRequest(request, context = {}) {
  if (!request || request.jsonrpc !== JSONRPC_VERSION || typeof request.method !== 'string') {
    return makeError(request && request.id, ERROR.INVALID_REQUEST, 'Invalid JSON-RPC request.');
  }

  const isNotification = request.id === undefined || request.id === null;
  const { id, method, params } = request;

  try {
    switch (method) {
      case 'initialize':
        return await handleInitialize(id);
      case 'notifications/initialized':
      case 'initialized':
        return null; // client notification, no response
      case 'ping':
        return makeResult(id, {});
      case 'tools/list':
        return await handleToolsList(id, context);
      case 'tools/call':
        return await handleToolsCall(id, params, context);
      default:
        if (isNotification) return null;
        return makeError(id, ERROR.METHOD_NOT_FOUND, `Unknown method: ${method}`);
    }
  } catch (err) {
    if (isNotification) return null;
    return makeError(id, ERROR.INTERNAL, err.message || 'Internal error.');
  }
}

/**
 * Handle a parsed JSON-RPC message that may be a single request or a batch.
 * Notifications are dropped from batch responses per the JSON-RPC spec.
 */
async function handleMessage(message, context = {}) {
  if (Array.isArray(message)) {
    if (message.length === 0) {
      return makeError(null, ERROR.INVALID_REQUEST, 'Empty batch.');
    }
    const responses = await Promise.all(message.map((m) => handleRequest(m, context)));
    const filtered = responses.filter((r) => r !== null);
    return filtered.length ? filtered : null;
  }
  return handleRequest(message, context);
}

module.exports = {
  handleRequest,
  handleMessage,
  visibleTools,
  JSONRPC_VERSION,
  PROTOCOL_VERSION,
  SERVER_INFO,
  ERROR,
  makeError,
  makeResult,
};
