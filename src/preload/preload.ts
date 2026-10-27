import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC, type ClipDietAPI, type ProgressPayload } from '../shared/types'

/**
 * Puente seguro: el renderer NO tiene acceso a Node ni a ipcRenderer directamente,
 * solo a esta API mínima y tipada.
 */
const api: ClipDietAPI = {
  selectFiles: () => ipcRenderer.invoke(IPC.selectFiles),
  selectFolder: () => ipcRenderer.invoke(IPC.selectFolder),
  probeFiles: (paths) => ipcRenderer.invoke(IPC.probe, paths),
  compress: (request) => ipcRenderer.invoke(IPC.compress, request),
  cancel: () => ipcRenderer.invoke(IPC.cancel),
  getSystemInfo: () => ipcRenderer.invoke(IPC.systemInfo),
  showInFolder: (filePath) => ipcRenderer.invoke(IPC.showItem, filePath),

  // Electron >= 32 eliminó `File.path`; webUtils es la forma soportada de obtener la ruta real.
  getPathForFile: (file) => webUtils.getPathForFile(file),

  onProgress: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: ProgressPayload): void => callback(payload)
    ipcRenderer.on(IPC.progress, listener)
    return () => {
      ipcRenderer.removeListener(IPC.progress, listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
console.log('[ClipDiet] Preload inicializado y window.api expuesto.')
