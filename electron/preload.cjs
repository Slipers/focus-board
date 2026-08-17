const { contextBridge, ipcRenderer } = require('electron');

// Volontairement pas « focus » : window.focus() est une API native du navigateur.
contextBridge.exposeInMainWorld('focusApi', {
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke('app:version'),

  boards: {
    list: () => ipcRenderer.invoke('boards:list'),
    read: (id) => ipcRenderer.invoke('boards:read', id),
    write: (doc) => ipcRenderer.invoke('boards:write', doc),
    remove: (id) => ipcRenderer.invoke('boards:delete', id),
    reveal: () => ipcRenderer.invoke('boards:reveal'),
  },

  settings: {
    read: () => ipcRenderer.invoke('settings:read'),
    write: (s) => ipcRenderer.invoke('settings:write', s),
  },

  files: {
    save: (args) => ipcRenderer.invoke('file:save', args),
    open: (filters) => ipcRenderer.invoke('file:open', filters),
    showItem: (p) => ipcRenderer.invoke('shell:showItem', p),
  },

  setTheme: (theme) => ipcRenderer.send('theme:set', theme),

  onMenu: (handler) => {
    const listener = (_e, command) => handler(command);
    ipcRenderer.on('menu', listener);
    return () => ipcRenderer.removeListener('menu', listener);
  },

  updater: {
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    onAvailable: (handler) => {
      const listener = (_e, info) => handler(info);
      ipcRenderer.on('updater:available', listener);
      return () => ipcRenderer.removeListener('updater:available', listener);
    },
    onProgress: (handler) => {
      const listener = (_e, progress) => handler(progress);
      ipcRenderer.on('updater:progress', listener);
      return () => ipcRenderer.removeListener('updater:progress', listener);
    },
    onReady: (handler) => {
      const listener = (_e, info) => handler(info);
      ipcRenderer.on('updater:ready', listener);
      return () => ipcRenderer.removeListener('updater:ready', listener);
    },
    onError: (handler) => {
      const listener = (_e, message) => handler(message);
      ipcRenderer.on('updater:error', listener);
      return () => ipcRenderer.removeListener('updater:error', listener);
    },
  },
});
