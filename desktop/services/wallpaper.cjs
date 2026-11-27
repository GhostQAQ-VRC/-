'use strict';

const path = require('node:path');
const fsp = require('node:fs/promises');
const { execFile } = require('node:child_process');
const sharp = require('sharp');
const { app } = require('electron');
const repository = require('../library/repository.cjs');
const { MAX_INPUT_PIXELS } = require('../library/constants.cjs');

function escapePowerShell(value) {
  return String(value || '').replace(/'/g, "''");
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 25_000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(String(stderr || error.message || '系统调用失败').trim()));
          return;
        }
        resolve(String(stdout || ''));
      },
    );
  });
}

/**
 * Convert any supported library image to a JPEG and hand it to Windows as the
 * desktop wallpaper. The generated copy lives in userData so the temporary
 * library path is never the wallpaper source.
 */
async function setWallpaper(root, relativePath) {
  if (process.platform !== 'win32') {
    throw new Error('设为壁纸仅支持 Windows 客户端。');
  }
  const absolute = await repository.resolveRealInside(root, relativePath);
  if (!absolute) throw new Error('照片路径不合法或不在存储库内。');

  const directory = path.join(app.getPath('userData'), 'wallpapers');
  await fsp.mkdir(directory, { recursive: true });
  // A unique target avoids Windows locking the previous file when the user
  // changes the wallpaper again.
  const target = path.join(directory, `wallpaper-${Date.now()}.jpg`);
  const temporary = `${target}.${process.pid}.tmp`;
  await sharp(absolute, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'none' })
    .rotate()
    .resize({ width: 2560, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toFile(temporary);
  await fsp.rename(temporary, target);

  // Best-effort cleanup of older generated wallpapers.
  const entries = await fsp.readdir(directory).catch(() => []);
  for (const name of entries) {
    if (!/^wallpaper-\d+\.jpg$/.test(name)) continue;
    const old = path.join(directory, name);
    if (old === target) continue;
    await fsp.rm(old, { force: true }).catch(() => {});
  }

  const script =
    "Add-Type -TypeDefinition 'using System.Runtime.InteropServices; " +
    'public class HoshikuzuWallpaper { ' +
    '[DllImport("user32.dll", CharSet=CharSet.Auto, SetLastError=true)] ' +
    'public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni); }' +
    "'; $result = [HoshikuzuWallpaper]::SystemParametersInfo(20, 0, '" +
    escapePowerShell(target) +
    "', 3); if ($result -eq 0) { exit 1 }";
  await runPowerShell(script);
  return { ok: true, path: target };
}

module.exports = { setWallpaper };
