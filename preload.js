'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nullplay', {
  getLibrary: () => ipcRenderer.invoke('library:get'),
  rescan: () => ipcRenderer.invoke('library:rescan'),
  launch: (id) => ipcRenderer.invoke('game:launch', String(id)),
  setFavorite: (id, on) => ipcRenderer.invoke('game:favorite', String(id), !!on),
  setOptions: (id, patch) => ipcRenderer.invoke('game:options', String(id), patch),
  openLauncher: (id) => ipcRenderer.invoke('game:open-launcher', String(id)),
  art: {
    status: () => ipcRenderer.invoke('art:status'),
    setKey: (key) => ipcRenderer.invoke('art:set-key', String(key)),
    options: (id, kind) => ipcRenderer.invoke('art:options', String(id), String(kind)),
    pick: (id, kind, index) => ipcRenderer.invoke('art:pick', String(id), String(kind), Number(index)),
    file: (id, kind) => ipcRenderer.invoke('art:file', String(id), String(kind)),
    reset: (id, kind) => ipcRenderer.invoke('art:reset', String(id), String(kind)),
  },
  sys: {
    status: () => ipcRenderer.invoke('sys:status'),
    wifiList: () => ipcRenderer.invoke('sys:wifi-list'),
    wifiConnect: (ssid, password) => ipcRenderer.invoke('sys:wifi-connect', String(ssid), password == null ? null : String(password)),
    wifiRadio: (on) => ipcRenderer.invoke('sys:wifi-radio', !!on),
    setVolume: (level) => ipcRenderer.invoke('sys:volume', Number(level)),
    toggleMute: () => ipcRenderer.invoke('sys:mute'),
    setBrightness: (level) => ipcRenderer.invoke('sys:brightness', Number(level)),
    controllers: () => ipcRenderer.invoke('sys:controllers'),
    btScan: () => ipcRenderer.invoke('sys:bt-scan'),
    btPair: (mac) => ipcRenderer.invoke('sys:bt-pair', String(mac)),
    btConnect: (mac, on) => ipcRenderer.invoke('sys:bt-connect', String(mac), !!on),
    btForget: (mac) => ipcRenderer.invoke('sys:bt-forget', String(mac)),
    power: (action) => ipcRenderer.invoke('sys:power', String(action)),
  },
  quit: () => ipcRenderer.invoke('app:quit'),
  info: () => ipcRenderer.invoke('app:info'),
  onLibraryChanged: (fn) => ipcRenderer.on('library:changed', (_e, d) => fn(d)),
  onGameStatus: (fn) => ipcRenderer.on('game:status', (_e, d) => fn(d)),
  onScanProgress: (fn) => ipcRenderer.on('scan:progress', (_e, d) => fn(d)),
});
