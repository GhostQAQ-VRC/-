'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const port = Number(process.env.MOBILE_PREVIEW_PORT || 0);
const secrets = new Map();

contextBridge.exposeInMainWorld('__HOSHIKUZU_MOBILE_MEDIA_BASE_OVERRIDE__', `http://127.0.0.1:${port}/media`);

contextBridge.exposeInMainWorld('HoshikuzuAndroid', {
  saveUrl: () => true,
  toast: () => {},
  appVersion: () => '1.1.1',
  secureGet: (key) => secrets.get(key) || '',
  secureSet: (key, value) => {
    secrets.set(key, value);
    return true;
  },
  secureDelete: (key) => {
    secrets.delete(key);
    return true;
  },
  pickMedia: (callbackId) => ipcRenderer.send('mock-pick', callbackId),
  deleteManaged: () => true,
  openExternal: () => {},
  openConnect: () => {},
  openLocal: () => {},
  httpRequest: (callbackId, requestJson) => {
    ipcRenderer.send('mock-http', callbackId, requestJson);
  },
});
