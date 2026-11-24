'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');
const electronPath = require('electron');

const root = path.join(__dirname, '..');
const port = Number(process.env.HOSHIKUZU_PORT || 5175);
const url = `http://127.0.0.1:${port}/`;
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

let vite = null;
let electron = null;
let shuttingDown = false;

function killTree(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    // Already gone.
  }
}

function probe() {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(true);
    });
    request.on('error', () => resolve(false));
    request.setTimeout(1200, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`Vite 未在 ${timeoutMs / 1000}s 内启动（${url}）。`);
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  killTree(electron);
  killTree(vite);
  setTimeout(() => process.exit(code), 200);
}

vite = spawn(process.execPath, [viteBin, '--port', String(port), '--strictPort'], {
  cwd: root,
  stdio: 'inherit',
});

vite.on('exit', (code) => {
  if (!shuttingDown) {
    console.error(`[desktop:dev] Vite 已退出（${code}）。`);
    shutdown(code ?? 1);
  }
});

waitForServer()
  .then(() => {
    console.log(`[desktop:dev] Vite 就绪：${url}`);
    electron = spawn(electronPath, [root], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, HOSHIKUZU_DEV_URL: url },
    });
    electron.on('exit', (code) => {
      console.log(`[desktop:dev] Electron 已退出（${code}）。`);
      shutdown(code ?? 0);
    });
  })
  .catch((error) => {
    console.error('[desktop:dev]', error.message);
    shutdown(1);
  });

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
