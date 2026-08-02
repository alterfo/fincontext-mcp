'use strict';

/**
 * Lockbox reader — the trust boundary of the whole product.
 *
 * Bank and accounting tokens (read-only scope) live in the CLIENT's Yandex
 * Lockbox, inside the client's own cloud. This module only ever READS them; it
 * never writes, logs, or forwards a secret value, and the developer never sees a
 * token. That is the architectural guarantee: tokens stay in the client's Lockbox
 * and are resolved at runtime by the client-deployed function's service account.
 *
 * As with the rest of the codebase there is no local Yandex Cloud emulator, so the
 * actual Lockbox call is injected via a `resolver` and the resolution logic here is
 * pure and unit-testable. A deployment supplies a real resolver backed by the
 * Lockbox API (`GET .../secrets/{id}/payload`); tests and local runs supply a fake
 * resolver or fall back to environment variables.
 *
 * Config maps a source to where its token lives:
 *   secrets: { tochka: {secret_id, key}, moysklad: {secret_id, key}, ... }
 * `key` is the entry name inside the Lockbox secret payload (default `token`).
 */

const DEFAULT_ENTRY_KEY = 'token';

/** Environment-variable name a source's token falls back to, e.g. LOCKBOX_TOCHKA_TOKEN. */
function envVarName(source) {
  return `LOCKBOX_${String(source).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_TOKEN`;
}

/**
 * @param {object} [opts]
 * @param {object} [opts.secrets]  Map source -> `{secret_id, key?}`.
 * @param {Function} [opts.resolver] async `(secretId) => { entries: {key: value} }`.
 *                                   When absent, falls back to `opts.env` / `process.env`.
 * @param {object} [opts.env]       Environment object for the fallback (default `process.env`).
 */
function createLockbox(opts = {}) {
  const secrets = opts.secrets || {};
  const resolver = opts.resolver || null;
  const env = opts.env || process.env;
  // Cache resolved payloads by secret id; secrets are stable for a function's life
  // and re-reading Lockbox on every tool call would be wasteful.
  const cache = new Map();

  /** Resolve a raw secret payload `{entries}` by its Lockbox secret id. */
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

  /**
   * Read a source's token. Uses the configured Lockbox secret when a resolver is
   * present; otherwise reads the `LOCKBOX_<SOURCE>_TOKEN` environment variable
   * (local dev / CI). Throws when the token cannot be found — callers must not
   * proceed with a missing credential.
   */
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

  /** Drop cached payloads (e.g. after a rotation) so the next read re-resolves. */
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
