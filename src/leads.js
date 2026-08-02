'use strict';

const https = require('https');
const crypto = require('crypto');
const { signRequest } = require('./sigv4');

function leadsConfig(env = process.env) {
  return {
    keyId: env.YC_STATIC_KEY_ID || '',
    secret: env.YC_STATIC_KEY_SECRET || '',
    region: env.YC_REGION || 'ru-central1',
    ydbEndpoint: env.LEADS_YDB_DOCAPI || '',
    table: env.LEADS_TABLE || 'leads',
    postboxEndpoint: env.POSTBOX_ENDPOINT || 'https://postbox.cloud.yandex.net',
    from: env.LEAD_NOTIFY_FROM || '',
    to: env.LEAD_NOTIFY_TO || '',
  };
}

function httpsPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        method: 'POST',
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        headers: { ...headers, 'content-length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
}

async function storeLead(lead, cfg, now) {
  if (!cfg.keyId || !cfg.secret || !cfg.ydbEndpoint) return { stored: false, reason: 'ydb_not_configured' };
  const item = {
    id: { S: lead.id },
    email: { S: lead.email },
    source: { S: lead.source || '' },
    company: { S: lead.company || '' },
    message: { S: lead.message || '' },
    created_at: { S: lead.created_at },
  };
  const body = JSON.stringify({ TableName: cfg.table, Item: item });
  const signed = signRequest({
    method: 'POST',
    url: cfg.ydbEndpoint,
    service: 'dynamodb',
    region: cfg.region,
    accessKeyId: cfg.keyId,
    secretAccessKey: cfg.secret,
    headers: { 'content-type': 'application/x-amz-json-1.0', 'x-amz-target': 'DynamoDB_20120810.PutItem' },
    body,
    now,
  });
  const res = await httpsPost(cfg.ydbEndpoint, signed.headers, body);
  if (res.status >= 200 && res.status < 300) return { stored: true };
  throw new Error(`ydb ${res.status}: ${res.body.slice(0, 200)}`);
}

async function notifyLead(lead, cfg, now) {
  if (!cfg.keyId || !cfg.secret || !cfg.from || !cfg.to) return { notified: false, reason: 'email_not_configured' };
  const params = new URLSearchParams();
  params.set('Action', 'SendEmail');
  params.set('Source', cfg.from);
  params.set('Destination.ToAddresses.member.1', cfg.to);
  params.set('Message.Subject.Data', `Новый лид FinContext: ${lead.email}`);
  params.set(
    'Message.Body.Text.Data',
    `Email: ${lead.email}\nИсточник: ${lead.source || '—'}\nКомпания: ${lead.company || '—'}\nСообщение: ${lead.message || '—'}\nВремя: ${lead.created_at}`
  );
  const body = params.toString();
  const signed = signRequest({
    method: 'POST',
    url: cfg.postboxEndpoint,
    service: 'ses',
    region: cfg.region,
    accessKeyId: cfg.keyId,
    secretAccessKey: cfg.secret,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    now,
  });
  const res = await httpsPost(cfg.postboxEndpoint, signed.headers, body);
  if (res.status >= 200 && res.status < 300) return { notified: true };
  throw new Error(`postbox ${res.status}: ${res.body.slice(0, 200)}`);
}

async function recordLead(input, env = process.env, now = new Date()) {
  const lead = {
    id: crypto.randomUUID(),
    email: input.email,
    source: input.source || '',
    company: input.company || '',
    message: input.message || '',
    created_at: now.toISOString(),
  };
  const cfg = leadsConfig(env);
  const out = { lead, stored: false, notified: false, errors: [] };

  try {
    const r = await storeLead(lead, cfg, now);
    out.stored = r.stored;
    if (r.reason) out.store_skipped = r.reason;
  } catch (err) {
    out.errors.push(`store: ${err.message}`);
  }

  try {
    const r = await notifyLead(lead, cfg, now);
    out.notified = r.notified;
    if (r.reason) out.notify_skipped = r.reason;
  } catch (err) {
    out.errors.push(`notify: ${err.message}`);
  }

  return out;
}

module.exports = { recordLead, leadsConfig, storeLead, notifyLead };
