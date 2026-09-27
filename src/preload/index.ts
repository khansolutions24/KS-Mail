import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { IPC_EVENT, IPC_INVOKE } from '@shared/api';

contextBridge.exposeInMainWorld('ksMail', {
  platform: process.platform,
  invoke: (method: string, args: unknown[]) => ipcRenderer.invoke(IPC_INVOKE, method, args),
  onEvent: (cb: (channel: string, payload: unknown) => void) => {
    const handler = (_e: IpcRendererEvent, channel: string, payload: unknown) => cb(channel, payload);
    ipcRenderer.on(IPC_EVENT, handler);
    return () => {
      ipcRenderer.removeListener(IPC_EVENT, handler);
    };
  },
  setTheme: (dark: boolean) => ipcRenderer.send('ksmail:theme', dark),
  pathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  }
});
