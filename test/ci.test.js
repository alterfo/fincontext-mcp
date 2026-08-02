'use strict';

const fs = require('fs');
const path = require('path');

const WORKFLOW = path.join(__dirname, '..', '.github', 'workflows', 'ci.yml');

describe('CI workflow', () => {
  let body;

  beforeAll(() => {
    body = fs.readFileSync(WORKFLOW, 'utf8');
  });

  test('workflow file exists', () => {
    expect(fs.existsSync(WORKFLOW)).toBe(true);
  });

  test('runs on push and pull_request', () => {
    expect(body).toMatch(/^on:/m);
    expect(body).toMatch(/^\s*push:/m);
    expect(body).toMatch(/^\s*pull_request:/m);
  });

  test('uses Node 18', () => {
    expect(body).toMatch(/setup-node/);
    expect(body).toMatch(/node-version:\s*['"]?18/);
  });

  test('runs ci, test, lint, and build steps', () => {
    expect(body).toMatch(/npm ci/);
    expect(body).toMatch(/npm test/);
    expect(body).toMatch(/npm run lint/);
    expect(body).toMatch(/npm run build/);
  });

  test('has a terraform fmt + validate job', () => {
    expect(body).toMatch(/setup-terraform/);
    expect(body).toMatch(/terraform fmt/);
    expect(body).toMatch(/terraform validate/);
  });
});
