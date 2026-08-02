'use strict';

const crypto = require('crypto');

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function signingKey(secret, date, region, service) {
  const kDate = hmac('AWS4' + secret, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

function amzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function encodeRfc3986(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function canonicalQuery(searchParams) {
  const pairs = [];
  for (const [k, v] of searchParams.entries()) pairs.push([encodeRfc3986(k), encodeRfc3986(v)]);
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
  return pairs.map((p) => `${p[0]}=${p[1]}`).join('&');
}

function signRequest(opts) {
  const { method, url, service, region, accessKeyId, secretAccessKey, body = '', now } = opts;
  const u = new URL(url);
  const dt = amzDate(now);
  const date = dt.slice(0, 8);
  const payloadHash = sha256Hex(body || '');

  const headers = {};
  for (const [k, v] of Object.entries(opts.headers || {})) headers[k.toLowerCase()] = String(v).trim();
  headers.host = u.host;
  headers['x-amz-date'] = dt;
  if (opts.contentSha256 !== false) headers['x-amz-content-sha256'] = payloadHash;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join('');
  const signedHeaders = names.join(';');

  const canonicalRequest = [
    method,
    u.pathname || '/',
    canonicalQuery(u.searchParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', dt, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = crypto
    .createHmac('sha256', signingKey(secretAccessKey, date, region, service))
    .update(stringToSign, 'utf8')
    .digest('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { authorization, signature, signedHeaders, headers: { ...headers, authorization } };
}

module.exports = { signRequest, signingKey, amzDate, sha256Hex };
