'use strict';

const { createLockbox, envVarName } = require('../src/lockbox');

describe('lockbox token resolution', () => {
  test('reads a token from the configured Lockbox secret via the injected resolver', async () => {
    const calls = [];
    const resolver = async (secretId) => {
      calls.push(secretId);
      return { entries: { token: 'sandbox.jwt.token' } };
    };
    const lb = createLockbox({
      secrets: { tochka: { secret_id: 'sec-tochka', key: 'token' } },
      resolver,
    });
    expect(await lb.getToken('tochka')).toBe('sandbox.jwt.token');
    // Cached: a second read does not re-hit the resolver.
    expect(await lb.getToken('tochka')).toBe('sandbox.jwt.token');
    expect(calls).toEqual(['sec-tochka']);
  });

  test('honors a custom entry key inside the secret payload', async () => {
    const resolver = async () => ({ entries: { api_token: 'moysklad-secret' } });
    const lb = createLockbox({
      secrets: { moysklad: { secret_id: 'sec-ms', key: 'api_token' } },
      resolver,
    });
    expect(await lb.getToken('moysklad')).toBe('moysklad-secret');
  });

  test('falls back to the environment variable when no resolver is configured', async () => {
    const lb = createLockbox({ env: { [envVarName('tochka')]: 'env-token' } });
    expect(await lb.getToken('tochka')).toBe('env-token');
  });

  test('throws when a token cannot be found', async () => {
    const lb = createLockbox({ env: {} });
    await expect(lb.getToken('tochka')).rejects.toThrow(/no token/i);
  });

  test('throws when the configured entry key is absent from the payload', async () => {
    const resolver = async () => ({ entries: { other: 'x' } });
    const lb = createLockbox({ secrets: { tochka: { secret_id: 's', key: 'token' } }, resolver });
    await expect(lb.getToken('tochka')).rejects.toThrow(/missing/i);
  });

  test('clearCache forces re-resolution', async () => {
    let n = 0;
    const resolver = async () => ({ entries: { token: `t${(n += 1)}` } });
    const lb = createLockbox({ secrets: { tochka: { secret_id: 's' } }, resolver });
    expect(await lb.getToken('tochka')).toBe('t1');
    expect(await lb.getToken('tochka')).toBe('t1');
    lb.clearCache();
    expect(await lb.getToken('tochka')).toBe('t2');
  });

  test('envVarName normalizes source names', () => {
    expect(envVarName('tochka')).toBe('LOCKBOX_TOCHKA_TOKEN');
    expect(envVarName('1c')).toBe('LOCKBOX_1C_TOKEN');
  });
});
