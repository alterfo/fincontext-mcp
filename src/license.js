'use strict';

const crypto = require('crypto');

const EMBEDDED_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA18Xj6JMe5XCLDknAdL7lP6xkd2TXPYgRyGPwmius+aM=
-----END PUBLIC KEY-----
`;

const KNOWN_MODULES = [
  'reconcile',
  'forecast',
  'alerts',
  'connectors:kontur',
  'connectors:1c',
];

const REASON = {
  MISSING: 'missing',
  MALFORMED: 'malformed',
  BAD_PAYLOAD: 'bad_payload',
  BAD_PLAN: 'bad_plan',
  BAD_SIGNATURE: 'bad_signature',
  EXPIRED: 'expired',
  OK: 'ok',
};

function b64urlEncode(input) {
  return Buffer.from(input).toString('base64url');
}

function b64urlToBuffer(str) {
  return Buffer.from(str, 'base64url');
}

function nowSeconds(injected) {
  if (Number.isFinite(injected)) return Math.floor(injected);
  return Math.floor(Date.now() / 1000);
}

function toPublicKey(key) {
  if (!key) return crypto.createPublicKey(EMBEDDED_PUBLIC_KEY_PEM);
  if (typeof key === 'object' && key.type) return key;
  return crypto.createPublicKey(key);
}

function normalizeModules(modules) {
  if (!Array.isArray(modules)) return [];
  return modules.filter((m) => KNOWN_MODULES.includes(m));
}

function signLicense(payload, privateKey) {
  const body = { plan: 'pro', iat: nowSeconds(), ...payload };
  const payloadB64 = b64urlEncode(JSON.stringify(body));
  const key = typeof privateKey === 'object' && privateKey.type
    ? privateKey
    : crypto.createPrivateKey(privateKey);
  const signature = crypto.sign(null, Buffer.from(payloadB64, 'utf8'), key);
  return `${payloadB64}.${b64urlEncode(signature)}`;
}

function verifyLicense(licenseKey, opts = {}) {
  if (typeof licenseKey !== 'string' || licenseKey.length === 0) {
    return { valid: false, reason: REASON.MISSING, modules: [], payload: null };
  }

  const parts = licenseKey.trim().split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false, reason: REASON.MALFORMED, modules: [], payload: null };
  }

  const [payloadB64, signatureB64] = parts;

  let payload;
  try {
    payload = JSON.parse(b64urlToBuffer(payloadB64).toString('utf8'));
  } catch (_err) {
    return { valid: false, reason: REASON.BAD_PAYLOAD, modules: [], payload: null };
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, reason: REASON.BAD_PAYLOAD, modules: [], payload: null };
  }

  let signatureOk = false;
  try {
    signatureOk = crypto.verify(
      null,
      Buffer.from(payloadB64, 'utf8'),
      toPublicKey(opts.publicKey),
      b64urlToBuffer(signatureB64)
    );
  } catch (_err) {
    signatureOk = false;
  }
  if (!signatureOk) {
    return { valid: false, reason: REASON.BAD_SIGNATURE, modules: [], payload: null };
  }

  if (payload.plan !== 'pro') {
    return { valid: false, reason: REASON.BAD_PLAN, modules: [], payload };
  }

  if (payload.exp !== undefined && payload.exp !== null) {
    const now = nowSeconds(opts.now);
    if (now >= Number(payload.exp)) {
      return { valid: false, reason: REASON.EXPIRED, modules: [], payload };
    }
  }

  return {
    valid: true,
    reason: REASON.OK,
    modules: normalizeModules(payload.modules),
    sub: payload.sub,
    exp: payload.exp ?? null,
    payload,
  };
}

function unlockedModules(licenseKey, opts = {}) {
  const result = verifyLicense(licenseKey, opts);
  return result.valid ? result.modules : [];
}

function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

module.exports = {
  EMBEDDED_PUBLIC_KEY_PEM,
  KNOWN_MODULES,
  REASON,
  signLicense,
  verifyLicense,
  unlockedModules,
  generateKeyPair,
  b64urlEncode,
};
