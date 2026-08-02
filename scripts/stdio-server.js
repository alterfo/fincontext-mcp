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

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(obj) {
  if (obj === null) return;
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

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
  // Skeleton context: no license, no handlers wired yet (Task 1).
  const result = await handleMessage(message, { handlers: {} });
  send(result);
});
