import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI, Event } from '../shared/contracts.js';
const api: DesktopAPI = {
  connection: () => ipcRenderer.invoke('connection'),
  forgetKey: () => ipcRenderer.invoke('forget-key'),
  status: () => ipcRenderer.invoke('status'),
  popout: () => ipcRenderer.invoke('popout'),
  preview: input => ipcRenderer.invoke('preview', input),
  apps: () => ipcRenderer.invoke('apps'),
  permission: kind => ipcRenderer.invoke('permission', kind),
  configure: config => ipcRenderer.invoke('configure', config),
  start: input => ipcRenderer.invoke('start', input),
  stop: () => ipcRenderer.invoke('stop'),
  approve: () => ipcRenderer.invoke('approve'),
  onEvent: listener => {
    const handler = (_event: Electron.IpcRendererEvent, value: Event) => listener(value);
    ipcRenderer.on('task:event', handler);
    return () => ipcRenderer.removeListener('task:event', handler);
  },
};
contextBridge.exposeInMainWorld('desktop', api);
