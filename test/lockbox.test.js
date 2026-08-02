'use strict';

const { createLockbox, lockboxFromEnv, secretsFromEnv, envVarName } = require('../src/lockbox');

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

describe('lockboxFromEnv', () => {
  test('secretsFromEnv maps LOCKBOX_<SOURCE>_ID vars with the configured key', () => {
    const secrets = secretsFromEnv({
      LOCKBOX_TOCHKA_ID: 'sec-tochka',
      LOCKBOX_MOYSKLAD_ID: 'sec-ms',
      LOCKBOX_TOKEN_KEY: 'api_token',
      LOCKBOX_TOCHKA_TOKEN: 'ignored',
    });
    expect(secrets).toEqual({
      tochka: { secret_id: 'sec-tochka', key: 'api_token' },
      moysklad: { secret_id: 'sec-ms', key: 'api_token' },
    });
  });

  test('defaults the entry key to token when LOCKBOX_TOKEN_KEY is unset', () => {
    expect(secretsFromEnv({ LOCKBOX_TOCHKA_ID: 'sec-tochka' })).toEqual({
      tochka: { secret_id: 'sec-tochka', key: 'token' },
    });
  });

  test('falls back to the env token path when no secret ids are configured', async () => {
    const lb = lockboxFromEnv({ [envVarName('tochka')]: 'env-token' });
    expect(await lb.getToken('tochka')).toBe('env-token');
  });

  test('resolves a token from Lockbox via the metadata IAM token and payload API', async () => {
    const requests = [];
    const fetchImpl = async (url, init) => {
      requests.push({ url, init });
      if (url.includes('169.254.169.254')) {
        return { ok: true, json: async () => ({ access_token: 'iam-xyz' }) };
      }
      return {
        ok: true,
        json: async () => ({ entries: [{ key: 'token', textValue: 'prod-secret' }] }),
      };
    };
    const lb = lockboxFromEnv(
      { LOCKBOX_TOCHKA_ID: 'sec-tochka', LOCKBOX_TOKEN_KEY: 'token' },
      { fetchImpl }
    );
    expect(await lb.getToken('tochka')).toBe('prod-secret');
    expect(requests[0].init.headers['Metadata-Flavor']).toBe('Google');
    expect(requests[1].url).toContain('/lockbox/v1/secrets/sec-tochka/payload');
    expect(requests[1].init.headers.Authorization).toBe('Bearer iam-xyz');
  });

  test('propagates a failed Lockbox payload request', async () => {
    const fetchImpl = async (url) => {
      if (url.includes('169.254.169.254')) {
        return { ok: true, json: async () => ({ access_token: 'iam-xyz' }) };
      }
      return { ok: false, status: 403, json: async () => ({}) };
    };
    const lb = lockboxFromEnv({ LOCKBOX_TOCHKA_ID: 'sec-tochka' }, { fetchImpl });
    await expect(lb.getToken('tochka')).rejects.toThrow(/payload request failed/i);
  });
});
