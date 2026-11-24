'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const electronPath = require('electron');

const root = path.join(__dirname, '..');
const noLibrary = process.argv.includes('--no-library');
const thumbnails = process.argv.includes('--thumbnail-setup');
const smokeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshikuzu-smoke-'));
const shotDir = path.join(
  __dirname,
  thumbnails ? '.smoke-thumbnails' : noLibrary ? '.smoke-onboarding' : '.smoke',
);

fs.rmSync(shotDir, { recursive: true, force: true });
fs.mkdirSync(shotDir, { recursive: true });

console.log(`[desktop:smoke] userData: ${smokeDir}`);
console.log(`[desktop:smoke] screenshots: ${shotDir}`);

const child = spawn(electronPath, [root], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    HOSHIKUZU_SMOKE: '1',
    HOSHIKUZU_SMOKE_DIR: smokeDir,
    HOSHIKUZU_SMOKE_NO_LIBRARY: noLibrary ? '1' : '0',
    HOSHIKUZU_SMOKE_THUMBS: thumbnails ? '1' : '0',
  },
});

child.on('exit', (code) => {
  const files = fs.existsSync(shotDir) ? fs.readdirSync(shotDir) : [];
  console.log(`[desktop:smoke] 截图：${files.join(', ') || '（无）'}`);
  fs.rmSync(smokeDir, { recursive: true, force: true });
  process.exit(code ?? 0);
});
