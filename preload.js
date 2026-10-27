'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nullplay', {
  getLibrary: () => ipcRenderer.invoke('library:get'),
  rescan: () => ipcRenderer.invoke('library:rescan'),
  launch: (id) => ipcRenderer.invoke('game:launch', String(id)),
  setFavorite: (id, on) => ipcRenderer.invoke('game:favorite', String(id), !!on),
  quit: () => ipcRenderer.invoke('app:quit'),
  info: () => ipcRenderer.invoke('app:info'),
  onLibraryChanged: (fn) => ipcRenderer.on('library:changed', (_e, d) => fn(d)),
  onGameStatus: (fn) => ipcRenderer.on('game:status', (_e, d) => fn(d)),
});
