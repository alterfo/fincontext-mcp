#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { generateKeyPair, signLicense, verifyLicense, KNOWN_MODULES } = require('../src/license');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i += 1;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function usage() {
  process.stderr.write(
    [
      'FinContext offline license key generator (developer-only).',
      '',
      'Usage:',
      '  node scripts/license-keygen.js keypair',
      '  node scripts/license-keygen.js issue --private <key.pem> --sub <id> \\',
      '       [--modules reconcile,forecast,alerts,connectors:kontur,connectors:1c] \\',
      '       [--exp <unix-seconds>] [--seats <n>]',
      '',
      `  Known modules: ${KNOWN_MODULES.join(', ')}`,
      '',
    ].join('\n')
  );
}

function cmdKeypair() {
  const { publicKeyPem, privateKeyPem } = generateKeyPair();
  process.stdout.write('# Public key — embed in src/license.js (EMBEDDED_PUBLIC_KEY_PEM):\n');
  process.stdout.write(publicKeyPem);
  process.stdout.write('\n# Private key — keep OFFLINE, never commit:\n');
  process.stdout.write(privateKeyPem);
}

function cmdIssue(args) {
  if (!args.private) throw new Error('--private <path-to-pkcs8-pem> is required');
  if (!args.sub) throw new Error('--sub <subscriber-id> is required');

  const privateKeyPem = fs.readFileSync(args.private, 'utf8');
  const modules = typeof args.modules === 'string'
    ? args.modules.split(',').map((m) => m.trim()).filter(Boolean)
    : KNOWN_MODULES.slice();

  const payload = { sub: args.sub, plan: 'pro', modules };
  if (args.exp) payload.exp = Number(args.exp);
  if (args.seats) payload.seats = Number(args.seats);

  const key = signLicense(payload, privateKeyPem);
  const check = verifyLicense(key, { publicKey: undefined });

  process.stdout.write(`${key}\n`);
  process.stderr.write(
    `issued for sub=${args.sub} modules=[${modules.join(', ')}]` +
      `${payload.exp ? ` exp=${payload.exp}` : ' (no expiry)'}\n` +
      `verify against embedded key: ${check.valid ? 'OK' : `FAILED (${check.reason})`}\n`
  );
}

function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const command = args._[0];

  try {
    if (command === 'keypair') return cmdKeypair();
    if (command === 'issue') return cmdIssue(args);
    usage();
    process.exit(command ? 1 : 0);
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { parseArgs };
