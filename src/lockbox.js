'use strict';

const DEFAULT_ENTRY_KEY = 'token';
const IAM_TOKEN_URL =
  'http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token';
const LOCKBOX_PAYLOAD_URL = 'https://payload.lockbox.api.cloud.yandex.net/lockbox/v1/secrets';

function envVarName(source) {
  return `LOCKBOX_${String(source).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_TOKEN`;
}

function secretsFromEnv(env) {
  const key = env.LOCKBOX_TOKEN_KEY || DEFAULT_ENTRY_KEY;
  const secrets = {};
  for (const name of Object.keys(env)) {
    const match = /^LOCKBOX_([A-Z0-9_]+)_ID$/.exec(name);
    if (!match) continue;
    const secretId = env[name];
    if (!secretId) continue;
    secrets[match[1].toLowerCase()] = { secret_id: secretId, key };
  }
  return secrets;
}

async function getIamToken(fetchImpl, env) {
  if (env.YC_IAM_TOKEN) return env.YC_IAM_TOKEN;
  const res = await fetchImpl(IAM_TOKEN_URL, { headers: { 'Metadata-Flavor': 'Google' } });
  if (!res.ok) throw new Error(`lockbox: iam token request failed (${res.status})`);
  const body = await res.json();
  if (!body || !body.access_token) throw new Error('lockbox: iam token response missing access_token');
  return body.access_token;
}

async function fetchLockboxPayload(secretId, fetchImpl, env) {
  const iamToken = await getIamToken(fetchImpl, env);
  const url = `${LOCKBOX_PAYLOAD_URL}/${encodeURIComponent(secretId)}/payload`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${iamToken}` } });
  if (!res.ok) throw new Error(`lockbox: payload request failed for ${secretId} (${res.status})`);
  const body = await res.json();
  const entries = {};
  for (const entry of (body && body.entries) || []) {
    if (entry.textValue !== undefined) entries[entry.key] = entry.textValue;
    else if (entry.binaryValue !== undefined) entries[entry.key] = entry.binaryValue;
  }
  return { entries };
}

function lockboxFromEnv(env = process.env, opts = {}) {
  const secrets = secretsFromEnv(env);
  if (Object.keys(secrets).length === 0) return createLockbox({ env });
  const fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!fetchImpl) throw new Error('lockbox: fetch is not available to resolve secrets');
  const resolver = (secretId) => fetchLockboxPayload(secretId, fetchImpl, env);
  return createLockbox({ secrets, resolver, env });
}

function createLockbox(opts = {}) {
  const secrets = opts.secrets || {};
  const resolver = opts.resolver || null;
  const env = opts.env || process.env;
  const cache = new Map();

  async function getSecret(secretId) {
    if (!secretId) throw new Error('lockbox: secret_id required');
    if (cache.has(secretId)) return cache.get(secretId);
    if (!resolver) throw new Error(`lockbox: no resolver configured for secret ${secretId}`);
    const payload = await resolver(secretId);
    const entries = (payload && payload.entries) || {};
    const normalized = { entries };
    cache.set(secretId, normalized);
    return normalized;
  }

  async function getToken(source) {
    const cfg = secrets[source];
    if (cfg && cfg.secret_id && resolver) {
      const { entries } = await getSecret(cfg.secret_id);
      const key = cfg.key || DEFAULT_ENTRY_KEY;
      const value = entries[key];
      if (value === undefined || value === null || value === '') {
        throw new Error(`lockbox: entry "${key}" missing in secret for source ${source}`);
      }
      return value;
    }
    const fromEnv = env[envVarName(source)];
    if (fromEnv) return fromEnv;
    throw new Error(`lockbox: no token available for source ${source}`);
  }

  function clearCache() {
    cache.clear();
  }

  return { getSecret, getToken, clearCache };
}

module.exports = {
  createLockbox,
  lockboxFromEnv,
  secretsFromEnv,
  envVarName,
  DEFAULT_ENTRY_KEY,
};
