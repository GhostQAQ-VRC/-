'use strict';

/**
 * Pure helpers for the GitHub release checker. Kept free of Electron imports
 * so version comparison and asset selection can be unit tested.
 */

function parseVersion(value) {
  const text = String(value || '')
    .trim()
    .replace(/^v/i, '');
  const [core] = text.split(/[-+]/);
  return core
    .split('.')
    .map((part) => {
      const number = Number.parseInt(part, 10);
      return Number.isFinite(number) ? number : 0;
    });
}

/** Returns 1 when a > b, -1 when a < b, 0 when equal. */
function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

function isGithubUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      url.pathname.startsWith('/GhostQAQ-VRC/-/releases/')
    );
  } catch {
    return false;
  }
}

function pickAssets(assets) {
  const list = Array.isArray(assets) ? assets : [];
  const byName = (pattern) =>
    list.find(
      (asset) =>
        asset &&
        typeof asset.name === 'string' &&
        pattern.test(asset.name) &&
        typeof asset.browser_download_url === 'string' &&
        isGithubUrl(asset.browser_download_url),
    );
  const setup =
    byName(/x64-setup\.exe$/i) ||
    byName(/setup\.exe$/i) ||
    byName(/x64\.exe$/i);
  const portable = byName(/portable\.exe$/i);
  return {
    setupUrl: setup ? setup.browser_download_url : '',
    setupName: setup ? setup.name : '',
    setupSize: setup && Number.isFinite(setup.size) ? setup.size : 0,
    portableUrl: portable ? portable.browser_download_url : '',
    portableName: portable ? portable.name : '',
    portableSize: portable && Number.isFinite(portable.size) ? portable.size : 0,
  };
}

/**
 * Turn a GitHub `/releases/latest` payload into the shape the renderer needs.
 * `hasUpdate` is false when the current version is the same or newer.
 */
function normalizeRelease(payload, currentVersion) {
  const latestTag =
    payload && typeof payload.tag_name === 'string' ? payload.tag_name.trim() : '';
  const latestVersion = latestTag.replace(/^v/i, '');
  const releaseUrl =
    payload && typeof payload.html_url === 'string' && isGithubUrl(payload.html_url)
      ? payload.html_url
      : 'https://github.com/GhostQAQ-VRC/-/releases';
  const assets = pickAssets(payload && payload.assets);
  return {
    ok: true,
    currentVersion: String(currentVersion || ''),
    latestVersion,
    latestTag,
    hasUpdate:
      Boolean(latestVersion) && compareVersions(latestVersion, currentVersion) > 0,
    name: payload && typeof payload.name === 'string' ? payload.name : latestTag,
    notes:
      payload && typeof payload.body === 'string'
        ? payload.body.trim().slice(0, 6000)
        : '',
    publishedAt:
      payload && typeof payload.published_at === 'string'
        ? payload.published_at
        : null,
    releaseUrl,
    ...assets,
  };
}

module.exports = {
  compareVersions,
  isGithubUrl,
  normalizeRelease,
  parseVersion,
  pickAssets,
};
