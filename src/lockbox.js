'use strict';

const DEFAULT_ENTRY_KEY = 'token';

function envVarName(source) {
  return `LOCKBOX_${String(source).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_TOKEN`;
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
  envVarName,
  DEFAULT_ENTRY_KEY,
};
