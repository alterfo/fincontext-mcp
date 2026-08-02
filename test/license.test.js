'use strict';

const crypto = require('crypto');
const {
  signLicense,
  verifyLicense,
  unlockedModules,
  generateKeyPair,
  REASON,
  KNOWN_MODULES,
} = require('../src/license');
const { loadConnectorFactory, connectorModule } = require('../src/connectors');
const { handleRequest } = require('../src/mcp');
const { ERROR } = require('../src/mcp');

const rpc = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, params });

function keypair() {
  const { publicKeyPem, privateKeyPem } = generateKeyPair();
  return {
    publicKey: crypto.createPublicKey(publicKeyPem),
    privateKey: crypto.createPrivateKey(privateKeyPem),
  };
}

describe('verifyLicense', () => {
  const { publicKey, privateKey } = keypair();

  test('accepts a valid pro key and returns the unlocked modules', () => {
    const key = signLicense(
      { sub: 'acme', modules: ['reconcile', 'forecast', 'alerts'] },
      privateKey
    );
    const res = verifyLicense(key, { publicKey });
    expect(res.valid).toBe(true);
    expect(res.reason).toBe(REASON.OK);
    expect(res.modules.sort()).toEqual(['alerts', 'forecast', 'reconcile']);
    expect(res.sub).toBe('acme');
  });

  test('drops unknown modules from the payload', () => {
    const key = signLicense(
      { sub: 'acme', modules: ['reconcile', 'not-a-real-module'] },
      privateKey
    );
    const res = verifyLicense(key, { publicKey });
    expect(res.valid).toBe(true);
    expect(res.modules).toEqual(['reconcile']);
  });

  test('rejects a missing key', () => {
    expect(verifyLicense('', { publicKey }).reason).toBe(REASON.MISSING);
    expect(verifyLicense(undefined, { publicKey }).reason).toBe(REASON.MISSING);
  });

  test('rejects a malformed key (wrong part count)', () => {
    expect(verifyLicense('onlyonepart', { publicKey }).reason).toBe(REASON.MALFORMED);
    expect(verifyLicense('a.b.c', { publicKey }).reason).toBe(REASON.MALFORMED);
  });

  test('rejects a tampered payload (signature mismatch)', () => {
    const key = signLicense({ sub: 'acme', modules: ['reconcile'] }, privateKey);
    const [, sig] = key.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 'acme', plan: 'pro', modules: KNOWN_MODULES })
    ).toString('base64url');
    const res = verifyLicense(`${forged}.${sig}`, { publicKey });
    expect(res.valid).toBe(false);
    expect(res.reason).toBe(REASON.BAD_SIGNATURE);
  });

  test('rejects a key signed by a different private key', () => {
    const other = keypair();
    const key = signLicense({ sub: 'acme', modules: ['reconcile'] }, other.privateKey);
    const res = verifyLicense(key, { publicKey });
    expect(res.valid).toBe(false);
    expect(res.reason).toBe(REASON.BAD_SIGNATURE);
  });

  test('rejects an expired key and honors injected now', () => {
    const key = signLicense(
      { sub: 'acme', modules: ['reconcile'], exp: 1000 },
      privateKey
    );
    const expired = verifyLicense(key, { publicKey, now: 2000 });
    expect(expired.valid).toBe(false);
    expect(expired.reason).toBe(REASON.EXPIRED);

    const stillValid = verifyLicense(key, { publicKey, now: 500 });
    expect(stillValid.valid).toBe(true);
  });

  test('rejects a non-pro plan', () => {
    const key = signLicense({ sub: 'acme', plan: 'free', modules: ['reconcile'] }, privateKey);
    const res = verifyLicense(key, { publicKey });
    expect(res.valid).toBe(false);
    expect(res.reason).toBe(REASON.BAD_PLAN);
  });

  test('unlockedModules returns [] for an invalid key and modules for a valid one', () => {
    expect(unlockedModules('garbage', { publicKey })).toEqual([]);
    const key = signLicense({ sub: 'acme', modules: ['forecast'] }, privateKey);
    expect(unlockedModules(key, { publicKey })).toEqual(['forecast']);
  });

  test('embedded public key verifies nothing forged with a random key', () => {
    const other = keypair();
    const key = signLicense({ sub: 'x', modules: ['reconcile'] }, other.privateKey);
    expect(verifyLicense(key).valid).toBe(false);
  });
});

describe('premium connector gating', () => {
  test('open connectors load without any modules', () => {
    expect(typeof loadConnectorFactory('tochka', { unlockedModules: [] })).toBe('function');
    expect(typeof loadConnectorFactory('moysklad', { unlockedModules: [] })).toBe('function');
  });

  test('premium connectors are gated behind their module', () => {
    expect(connectorModule('kontur')).toBe('connectors:kontur');
    expect(connectorModule('1c')).toBe('connectors:1c');
    let err;
    try {
      loadConnectorFactory('kontur', { unlockedModules: [] });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.code).toBe('UPGRADE_REQUIRED');
    expect(err.module).toBe('connectors:kontur');
  });

  test('unknown connector source throws', () => {
    expect(() => loadConnectorFactory('sberbank', {})).toThrow(/unknown connector/);
  });
});

describe('MCP premium gating end-to-end', () => {
  const { publicKey, privateKey } = keypair();

  function modulesFrom(payload) {
    const key = signLicense(payload, privateKey);
    return unlockedModules(key, { publicKey });
  }

  test('no license hides premium tools in tools/list', async () => {
    const res = await handleRequest(rpc('tools/list', {}), { unlockedModules: [] });
    const names = res.result.tools.map((t) => t.name).sort();
    expect(names).toEqual(['check_payment', 'get_cash_position']);
  });

  test('a valid key surfaces its premium tools in tools/list', async () => {
    const modules = modulesFrom({ sub: 'acme', modules: ['reconcile', 'forecast'] });
    const res = await handleRequest(rpc('tools/list', {}), { unlockedModules: modules });
    const names = res.result.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'cashgap_forecast',
      'check_payment',
      'get_cash_position',
      'reconcile',
    ]);
  });

  test('premium call without the module returns the upgrade error', async () => {
    const res = await handleRequest(
      rpc('tools/call', { name: 'reconcile', arguments: {} }),
      { unlockedModules: [] }
    );
    expect(res.error.code).toBe(ERROR.UPGRADE_REQUIRED);
    expect(res.error.data.upgrade_url).toBeDefined();
  });

  test('premium call with the module passes the gate', async () => {
    const modules = modulesFrom({ sub: 'acme', modules: ['reconcile'] });
    const handler = jest.fn(async () => ({ ok: true }));
    const res = await handleRequest(
      rpc('tools/call', { name: 'reconcile', arguments: {} }),
      { unlockedModules: modules, handlers: { reconcile: handler } }
    );
    expect(handler).toHaveBeenCalled();
    expect(res.result).toEqual({ ok: true });
  });
});
