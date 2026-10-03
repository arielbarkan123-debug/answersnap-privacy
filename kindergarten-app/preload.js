const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kgApi', {
  load: () => ipcRenderer.invoke('data:load'),
  save: (data, opts) => ipcRenderer.invoke('data:save', data, opts),
  info: () => ipcRenderer.invoke('data:info'),
  openFolder: () => ipcRenderer.invoke('data:openFolder'),
});
