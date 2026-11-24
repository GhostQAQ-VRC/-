'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function walk(directory, out = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, out);
    else if (entry.isFile() && entry.name.endsWith('.test.cjs')) out.push(absolute);
  }
  return out;
}

const files = walk(__dirname).sort();
if (files.length === 0) {
  console.error('[test:desktop] 没有找到测试文件。');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
