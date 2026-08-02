'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const INFRA = path.join(__dirname, '..', 'infra');

function read(name) {
  return fs.readFileSync(path.join(INFRA, name), 'utf8');
}

function stripComments(hcl) {
  return hcl
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').replace(/\/\/.*$/, ''))
    .join('\n');
}

function countChar(str, ch) {
  return str.split(ch).length - 1;
}

const TF_FILES = ['versions.tf', 'variables.tf', 'main.tf', 'outputs.tf'];

describe('infra Terraform module — structure', () => {
  test('all expected files exist', () => {
    for (const f of [...TF_FILES, 'openapi.yaml.tftpl', 'terraform.tfvars.example', 'README.md']) {
      expect(fs.existsSync(path.join(INFRA, f))).toBe(true);
    }
  });

  test('every .tf file has balanced braces', () => {
    for (const f of TF_FILES) {
      const body = stripComments(read(f));
      expect(countChar(body, '{')).toBe(countChar(body, '}'));
    }
  });

  test('provider and versions are pinned', () => {
    const v = read('versions.tf');
    expect(v).toMatch(/required_version\s*=\s*">= 1\.5\.0"/);
    expect(v).toMatch(/source\s*=\s*"yandex-cloud\/yandex"/);
    expect(v).toMatch(/provider\s+"yandex"/);
  });

  test('no leftover skeleton placeholders remain', () => {
    const main = read('main.tf');
    expect(main).not.toMatch(/skeleton-placeholder/);
  });
});

describe('infra Terraform module — resources', () => {
  const main = read('main.tf');

  const REQUIRED_RESOURCES = [
    ['yandex_iam_service_account', 'fincontext'],
    ['yandex_ydb_database_iam_binding', 'ydb_editor'],
    ['yandex_function_iam_binding', 'mcp_invoker'],
    ['yandex_function_iam_binding', 'sync_invoker'],
    ['yandex_ydb_database_serverless', 'fincontext'],
    ['yandex_lockbox_secret', 'tochka'],
    ['yandex_lockbox_secret', 'moysklad'],
    ['yandex_lockbox_secret_iam_member', 'tochka_viewer'],
    ['yandex_lockbox_secret_iam_member', 'moysklad_viewer'],
    ['yandex_function', 'mcp'],
    ['yandex_function', 'sync'],
    ['yandex_function_trigger', 'sync_timer'],
    ['yandex_api_gateway', 'mcp'],
  ];

  test.each(REQUIRED_RESOURCES)('declares resource %s.%s', (type, name) => {
    const re = new RegExp(`resource\\s+"${type}"\\s+"${name}"\\s*{`);
    expect(main).toMatch(re);
  });

  test('functions run as the least-privilege service account', () => {
    const invocations = main.match(/service_account_id\s*=\s*yandex_iam_service_account\.fincontext\.id/g) || [];
    expect(invocations.length).toBeGreaterThanOrEqual(3);
  });

  test('the sync function is driven by a timer trigger', () => {
    expect(main).toMatch(/timer\s*{[^}]*cron_expression\s*=\s*var\.sync_cron/s);
    expect(main).toMatch(/id\s*=\s*yandex_function\.sync\.id/);
  });

  test('access is granted per-resource, never folder-wide', () => {
    expect(main).toMatch(/role\s*=\s*"lockbox\.payloadViewer"/);
    expect(main).not.toMatch(/role\s*=\s*"lockbox\.admin"/);
    const folderMembers = main.match(/resource\s+"yandex_resourcemanager_folder_iam_(member|binding)"/g) || [];
    expect(folderMembers.length).toBe(0);
    expect(main).toMatch(/resource\s+"yandex_ydb_database_iam_binding"\s+"ydb_editor"\s*{[^}]*database_id\s*=\s*yandex_ydb_database_serverless\.fincontext\.id/s);
    for (const role of ['ydb.editor', 'functions.functionInvoker']) {
      expect(main).toMatch(new RegExp(`role\\s*=\\s*"${role.replace('.', '\\.')}"`));
    }
    const functionBindings = main.match(/resource\s+"yandex_function_iam_binding"/g) || [];
    expect(functionBindings.length).toBe(2);
    const lockboxMembers = main.match(/resource\s+"yandex_lockbox_secret_iam_member"/g) || [];
    expect(lockboxMembers.length).toBe(2);
  });
});

describe('infra Terraform module — referential integrity', () => {
  const varsBody = read('variables.tf');
  const declaredVars = new Set([...varsBody.matchAll(/variable\s+"([^"]+)"/g)].map((m) => m[1]));

  const REQUIRED_VARS = [
    'cloud_id',
    'folder_id',
    'zone',
    'function_name',
    'runtime',
    'function_memory',
    'function_timeout',
    'mcp_zip_path',
    'sync_zip_path',
    'sync_cron',
    'report_currency',
    'pro_key',
    'tochka_base_url',
    'moysklad_base_url',
    'lockbox_token_key',
  ];

  test.each(REQUIRED_VARS)('variable %s is declared', (name) => {
    expect(declaredVars.has(name)).toBe(true);
  });

  test('every var.X referenced in main/outputs is declared', () => {
    const referenced = new Set();
    for (const f of ['main.tf', 'outputs.tf']) {
      const body = stripComments(read(f));
      for (const m of body.matchAll(/var\.([a-zA-Z0-9_]+)/g)) referenced.add(m[1]);
    }
    for (const name of referenced) {
      expect(declaredVars.has(name)).toBe(true);
    }
  });

  test('pro_key variable is marked sensitive', () => {
    expect(varsBody).toMatch(/variable\s+"pro_key"\s*{[^}]*sensitive\s*=\s*true/s);
  });

  test('outputs expose the deploy essentials', () => {
    const outputs = read('outputs.tf');
    for (const name of ['mcp_endpoint', 'service_account_id', 'ydb_database_path', 'lockbox_secret_ids', 'sync_function_id']) {
      expect(outputs).toMatch(new RegExp(`output\\s+"${name}"`));
    }
  });

  test('openapi template placeholders are all supplied by the templatefile call', () => {
    const tpl = read('openapi.yaml.tftpl');
    const placeholders = new Set([...tpl.matchAll(/\$\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]));
    const main = read('main.tf');
    const callArgs = main.match(/templatefile\([^)]*openapi\.yaml\.tftpl[^)]*,\s*{([\s\S]*?)}\s*\)/);
    expect(callArgs).not.toBeNull();
    const supplied = new Set([...callArgs[1].matchAll(/([a-zA-Z0-9_]+)\s*=/g)].map((m) => m[1]));
    for (const p of placeholders) {
      expect(supplied.has(p)).toBe(true);
    }
  });
});

describe('infra Terraform module — terraform CLI (optional)', () => {
  function hasTerraform() {
    try {
      execFileSync('terraform', ['version'], { stdio: 'ignore' });
      return true;
    } catch (_e) {
      return false;
    }
  }

  const maybe = hasTerraform() ? test : test.skip;

  maybe('terraform validate passes', () => {
    execFileSync('terraform', ['init', '-backend=false', '-input=false'], { cwd: INFRA, stdio: 'ignore' });
    execFileSync('terraform', ['validate'], { cwd: INFRA, stdio: 'ignore' });
  });
});
