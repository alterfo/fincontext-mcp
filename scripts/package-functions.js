'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, 'infra', 'build');

function packageFunction(name) {
  const stage = path.join(buildDir, `stage-${name}`);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });

  fs.cpSync(path.join(root, 'src'), path.join(stage, 'src'), { recursive: true });

  const handlerSrc = fs.readFileSync(path.join(root, 'functions', name, 'index.js'), 'utf8');
  const rewritten = handlerSrc.replace(/require\('\.\.\/\.\.\/src\//g, "require('./src/");
  fs.writeFileSync(path.join(stage, 'index.js'), rewritten);

  const zipPath = path.join(buildDir, `${name}.zip`);
  fs.rmSync(zipPath, { force: true });
  execSync(`cd ${JSON.stringify(stage)} && zip -qr ${JSON.stringify(zipPath)} index.js src`);
  fs.rmSync(stage, { recursive: true, force: true });

  const bytes = fs.statSync(zipPath).size;
  return { name, zipPath: path.relative(root, zipPath), bytes };
}

fs.mkdirSync(buildDir, { recursive: true });
for (const name of ['mcp', 'sync']) {
  const out = packageFunction(name);
  process.stdout.write(`packaged ${out.name} -> ${out.zipPath} (${out.bytes} bytes)\n`);
}
