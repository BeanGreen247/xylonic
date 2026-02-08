const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  getColorConfigPath: (username) => ipcRenderer.invoke('get-color-config-path', username),
  readColorConfig: (username) => ipcRenderer.invoke('read-color-config', username),
  writeColorConfig: (username, config) => ipcRenderer.invoke('write-color-config', username, config),
});
