'use strict';

const { TOOLS, toListEntry, getTool } = require('./tools');

const JSONRPC_VERSION = '2.0';
const PROTOCOL_VERSION = '2025-06-18';

const SERVER_INFO = {
  name: 'fincontext-mcp',
  version: '0.1.0',
};

const ERROR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
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
    return makeError(id, ERROR.INTERNAL, `Tool "${name}" is not implemented yet.`, {
      not_implemented: true,
    });
  }

  const output = await handler((params && params.arguments) || {}, context);
  return makeResult(id, output);
}

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
        return null;
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
