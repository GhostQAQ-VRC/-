'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const send = (channel, ...args) => ipcRenderer.send(channel, ...args);
const sendSync = (channel, ...args) => ipcRenderer.sendSync(channel, ...args);

function subscribe(channel, callback) {
  const listener = (_event, payload) => {
    try {
      callback(payload);
    } catch (error) {
      console.error(`[hoshikuzu] ${channel} listener failed`, error);
    }
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

function encodePath(relativePath) {
  return String(relativePath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

contextBridge.exposeInMainWorld('hoshikuzu', {
  desktop: {
    version: '1.0.0',
    platform: process.platform,
    library: {
      getConfig: () => invoke('library:get-config'),
      chooseFolder: () => invoke('library:choose-folder'),
      createFolder: () => invoke('library:create-folder'),
      dismissOnboarding: () => invoke('library:dismiss-onboarding'),
      getThumbnailPresets: () => invoke('library:get-thumbnail-presets'),
      sampleThumbnailPreview: () => invoke('library:sample-thumbnail-preview'),
      setupThumbnails: (payload) => invoke('library:setup-thumbnails', payload),
      openFolder: () => invoke('library:open-folder'),
      revealFile: (relativePath) => invoke('library:reveal-file', relativePath),
      scan: (options) => invoke('library:scan', options),
      cancelScan: () => invoke('library:cancel-scan'),
      setOptions: (options) => invoke('library:set-options', options),
      ignoreHashes: (hashes) => invoke('library:ignore-hashes', hashes),
      resetIgnored: () => invoke('library:reset-ignored'),
      stats: () => invoke('library:stats'),
      clearPreviewCache: () => invoke('library:clear-preview-cache'),
      onScanProgress: (callback) => subscribe('library:scan-progress', callback),
      onPreviewReady: (callback) => subscribe('library:preview-ready', callback),
      onPreviewProgress: (callback) => subscribe('library:preview-progress', callback),
      onLibraryChanged: (callback) => subscribe('library:changed', callback),
    },
    album: {
      loadSync: () => sendSync('album:load-sync'),
      saveSync: (json) => sendSync('album:save-sync', json),
      resetSync: () => sendSync('album:reset-sync'),
    },
    media: {
      getPathForFile: (file) => {
        try {
          return webUtils.getPathForFile(file);
        } catch {
          return '';
        }
      },
      pickAndImport: () => invoke('media:pick-and-import'),
      importFiles: (paths) => invoke('media:import-files', paths),
      importDataUrls: (items) => invoke('media:import-data-urls', items),
      deleteManaged: (contentHash) => invoke('media:delete-managed', contentHash),
      urlForPreview: (previewPath) => `hoshikuzu-media://preview/${encodePath(previewPath)}`,
      urlForOriginal: (libraryPath) => `hoshikuzu-media://original/${encodePath(libraryPath)}`,
    },
    backup: {
      exportMetadata: () => invoke('backup:export-metadata'),
      exportFull: () => invoke('backup:export-full'),
      importFile: () => invoke('backup:import-file'),
    },
    background: {
      saveVideo: (payload) => invoke('background:save-video', payload),
      deleteVideo: (key) => invoke('background:delete-video', key),
    },
    network: {
      getConfig: () => invoke('network:get-config'),
      setProxy: (patch) => invoke('network:set-proxy', patch),
      test: (payload) => invoke('network:test', payload),
    },
    vrchat: {
      getConfig: () => invoke('vrchat:get-config'),
      setConfig: (patch) => invoke('vrchat:set-config', patch),
      status: () => invoke('vrchat:status'),
      login: (payload) => invoke('vrchat:login', payload),
      verify2fa: (payload) => invoke('vrchat:verify-2fa', payload),
      logout: () => invoke('vrchat:logout'),
      fetchCovers: (payload) => invoke('vrchat:fetch-covers', payload),
      cancelCovers: () => invoke('vrchat:cancel-covers'),
      onCoverProgress: (callback) => subscribe('vrchat:cover-progress', callback),
    },
    update: {
      check: () => invoke('update:check'),
      open: (url) => invoke('update:open', url),
      onAvailable: (callback) => subscribe('update:available', callback),
    },
    window: {
      minimize: () => send('window:minimize'),
      toggleMaximize: () => send('window:toggle-maximize'),
      close: () => send('window:close'),
      isMaximized: () => invoke('window:is-maximized'),
      onMaximizedChange: (callback) => subscribe('window:maximized-changed', callback),
    },
    app: {
      info: () => invoke('app:info'),
      openExternal: (url) => invoke('app:open-external', url),
      onCommand: (callback) => subscribe('app:command', callback),
    },
    sync: {
      getConfig: () => invoke('sync:get-config'),
      setConfig: (patch) => invoke('sync:set-config', patch),
      chooseFolder: () => invoke('sync:choose-folder'),
      test: (payload) => invoke('sync:test', payload),
      start: (payload) => invoke('sync:start', payload),
      cancel: () => invoke('sync:cancel'),
      status: () => invoke('sync:status'),
      resetManifest: () => invoke('sync:reset-manifest'),
      onProgress: (callback) => subscribe('sync:progress', callback),
      onDone: (callback) => subscribe('sync:done', callback),
      onState: (callback) => subscribe('sync:state', callback),
      onConfig: (callback) => subscribe('sync:config', callback),
      onStatus: (callback) => subscribe('sync:status', callback),
    },
    ai: {
      getConfig: () => invoke('ai:get-config'),
      setConfig: (patch) => invoke('ai:set-config', patch),
      test: (payload) => invoke('ai:test', payload),
      listModels: (payload) => invoke('ai:list-models', payload),
      generate: (payload) => invoke('ai:generate', payload),
      recognizeWorldId: (payload) => invoke('ai:recognize-world-id', payload),
      detectOrientation: (payload) => invoke('ai:detect-orientation', payload),
      startBatch: (payload) => invoke('ai:start-batch', payload),
      cancelBatch: () => invoke('ai:cancel-batch'),
      onBatchProgress: (callback) => subscribe('ai:batch-progress', callback),
      onBatchResult: (callback) => subscribe('ai:batch-result', callback),
      onBatchDone: (callback) => subscribe('ai:batch-done', callback),
    },
    easytier: {
      getConfig: () => invoke('easytier:get-config'),
      setConfig: (patch) => invoke('easytier:set-config', patch),
      detect: () => invoke('easytier:detect'),
      chooseCore: () => invoke('easytier:choose-core'),
      download: () => invoke('easytier:download'),
      start: () => invoke('easytier:start'),
      stop: () => invoke('easytier:stop'),
      status: () => invoke('easytier:status'),
      test: () => invoke('easytier:test'),
      logs: () => invoke('easytier:logs'),
      toml: () => invoke('easytier:toml'),
      openFolder: () => invoke('easytier:open-folder'),
      elevate: () => invoke('easytier:elevate'),
      onStatus: (callback) => subscribe('easytier:status', callback),
      onLog: (callback) => subscribe('easytier:log', callback),
      onDownloadProgress: (callback) => subscribe('easytier:download-progress', callback),
    },
    transfer: {
      getConfig: () => invoke('transfer:get-config'),
      setConfig: (patch) => invoke('transfer:set-config', patch),
      startReceiver: () => invoke('transfer:start-receiver'),
      stopReceiver: () => invoke('transfer:stop-receiver'),
      status: () => invoke('transfer:status'),
      testTarget: (payload) => invoke('transfer:test-target', payload),
      send: (payload) => invoke('transfer:send', payload),
      regenerateToken: () => invoke('transfer:regenerate-token'),
      onIncoming: (callback) => subscribe('transfer:incoming', callback),
      onProgress: (callback) => subscribe('transfer:progress', callback),
    },
  },
});
