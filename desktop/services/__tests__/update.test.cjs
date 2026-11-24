'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compareVersions,
  isGithubUrl,
  normalizeRelease,
  pickAssets,
} = require('../update-check.cjs');

test('compareVersions handles v prefixes and different segment counts', () => {
  assert.equal(compareVersions('v1.0.2', '1.0.1'), 1);
  assert.equal(compareVersions('1.0.1', 'v1.0.1'), 0);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.9', '1.1.0'), -1);
  assert.equal(compareVersions('2.0.0', '10.0.0'), -1);
});

test('isGithubUrl only allows this repository release links', () => {
  assert.equal(
    isGithubUrl(
      'https://github.com/GhostQAQ-VRC/-/releases/download/v1.0.2/VRchat-Timeline-Album-1.0.2-x64-setup.exe',
    ),
    true,
  );
  assert.equal(isGithubUrl('https://github.com/other/repo/releases'), false);
  assert.equal(isGithubUrl('http://github.com/GhostQAQ-VRC/-/releases'), false);
  assert.equal(isGithubUrl('not a url'), false);
});

test('normalizeRelease picks setup and portable assets and detects updates', () => {
  const payload = {
    tag_name: 'v1.0.2',
    name: 'v1.0.2',
    html_url: 'https://github.com/GhostQAQ-VRC/-/releases/tag/v1.0.2',
    body: '修复说明',
    published_at: '2026-11-25T00:00:00Z',
    assets: [
      {
        name: 'VRchat-Timeline-Album-1.0.2-x64-setup.exe',
        size: 100,
        browser_download_url:
          'https://github.com/GhostQAQ-VRC/-/releases/download/v1.0.2/VRchat-Timeline-Album-1.0.2-x64-setup.exe',
      },
      {
        name: 'VRchat-Timeline-Album-1.0.2-portable.exe',
        size: 90,
        browser_download_url:
          'https://github.com/GhostQAQ-VRC/-/releases/download/v1.0.2/VRchat-Timeline-Album-1.0.2-portable.exe',
      },
    ],
  };
  const result = normalizeRelease(payload, '1.0.1');
  assert.equal(result.ok, true);
  assert.equal(result.latestVersion, '1.0.2');
  assert.equal(result.hasUpdate, true);
  assert.equal(result.setupName, 'VRchat-Timeline-Album-1.0.2-x64-setup.exe');
  assert.equal(result.portableSize, 90);
  assert.equal(normalizeRelease(payload, '1.0.2').hasUpdate, false);
  assert.equal(normalizeRelease(payload, '1.0.3').hasUpdate, false);
});

test('pickAssets ignores unsafe or mismatched assets', () => {
  const assets = pickAssets([
    {
      name: 'VRchat-Timeline-Album-1.0.2-x64-setup.exe',
      browser_download_url: 'https://evil.example/setup.exe',
    },
    {
      name: 'VRchat-Timeline-Album-1.0.2-x64-setup.exe',
      browser_download_url:
        'https://github.com/GhostQAQ-VRC/-/releases/download/v1.0.2/setup.exe',
    },
  ]);
  assert.match(assets.setupUrl, /github\.com\/GhostQAQ-VRC/);
  assert.equal(assets.portableUrl, '');
});
