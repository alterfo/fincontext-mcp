#!/usr/bin/env node
'use strict';

/**
 * MCP stdio transport for local verification with MCP Inspector:
 *
 *   npx @modelcontextprotocol/inspector node scripts/stdio-server.js
 *
 * Reads newline-delimited JSON-RPC messages on stdin and writes newline-
 * delimited JSON-RPC responses on stdout. All routing is delegated to
 * `src/mcp.js`; this file is just the stdio adapter (mirror of the FaaS
 * HTTP adapter in `functions/mcp/index.js`).
 */

const readline = require('readline');
const { handleMessage, makeError, ERROR } = require('../src/mcp');
const { createStore } = require('../src/ydb');
const { createOpenHandlers, createPremiumHandlers, syncSource } = require('../src/handlers');
const { createTochkaConnector } = require('../src/connectors/tochka');
const { createMoyskladConnector } = require('../src/connectors/moysklad');
const { createLockbox } = require('../src/lockbox');
const { unlockedModules } = require('../src/license');

const store = createStore();
const handlers = { ...createOpenHandlers(store), ...createPremiumHandlers(store) };
const modules = unlockedModules(process.env.FINCONTEXT_PRO_KEY);

async function seedFromSandbox() {
  const lockbox = createLockbox();
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86400000);
  const period = { from: from.toISOString(), to: to.toISOString(), as_of: to.toISOString() };

  let tochkaToken;
  try {
    tochkaToken = await lockbox.getToken('tochka');
  } catch (_err) {
    tochkaToken = null;
  }
  if (tochkaToken) {
    const connector = createTochkaConnector({
      token: tochkaToken,
      baseUrl: process.env.TOCHKA_BASE_URL || undefined,
    });
    await syncSource(store, connector, period);
  }

  let moyskladToken;
  try {
    moyskladToken = await lockbox.getToken('moysklad');
  } catch (_err) {
    moyskladToken = null;
  }
  if (moyskladToken) {
    const connector = createMoyskladConnector({
      token: moyskladToken,
      baseUrl: process.env.MOYSKLAD_BASE_URL || undefined,
    });
    await syncSource(store, connector, period);
  }
}

function send(obj) {
  if (obj === null) return;
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

const ready = seedFromSandbox().catch((err) => {
  process.stderr.write(`stdio-server: sandbox seed skipped: ${err.message}\n`);
});

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', async (line) => {
  const text = line.trim();
  if (!text) return;
  let message;
  try {
    message = JSON.parse(text);
  } catch (_err) {
    send(makeError(null, ERROR.PARSE, 'Parse error: invalid JSON.'));
    return;
  }
  await ready;
  const result = await handleMessage(message, { store, handlers, unlockedModules: modules });
  send(result);
});
