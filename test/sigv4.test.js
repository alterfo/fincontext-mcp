'use strict';

const { signRequest, signingKey } = require('../src/sigv4');

describe('SigV4', () => {
  test('signing key HMAC chain is deterministic', () => {
    const key = signingKey('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20150830', 'us-east-1', 'service').toString('hex');
    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[0-9a-f]+$/);
  });

  test('reproduces the official get-vanilla test-suite signature', () => {
    const res = signRequest({
      method: 'GET',
      url: 'https://example.amazonaws.com/',
      service: 'service',
      region: 'us-east-1',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      body: '',
      contentSha256: false,
      now: new Date('2015-08-30T12:36:00Z'),
    });
    expect(res.signature).toBe('5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
    expect(res.signedHeaders).toBe('host;x-amz-date');
    expect(res.authorization).toContain('Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request');
  });

  test('signs POST bodies and includes x-amz-target in signed headers', () => {
    const res = signRequest({
      method: 'POST',
      url: 'https://docapi.serverless.yandexcloud.net/ru-central1/db',
      service: 'dynamodb',
      region: 'ru-central1',
      accessKeyId: 'KEY',
      secretAccessKey: 'SECRET',
      headers: { 'content-type': 'application/x-amz-json-1.0', 'x-amz-target': 'DynamoDB_20120810.PutItem' },
      body: '{"TableName":"leads"}',
      now: new Date('2026-08-02T10:00:00Z'),
    });
    expect(res.signedHeaders).toContain('x-amz-target');
    expect(res.signedHeaders).toContain('x-amz-content-sha256');
    expect(res.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
  });
});
