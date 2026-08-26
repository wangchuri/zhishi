import { contextBridge, ipcRenderer } from "electron"

export type BackendLogSnapshot = {
  lines: string[]
  logFile: string
  managed: boolean
  running: boolean
}

contextBridge.exposeInMainWorld("zhishi", {
  isElectron: true,
  platform: process.platform,
  backendUrl: process.env.ZHISHI_BACKEND_URL || "http://127.0.0.1:7777",
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  getBackendLogs: (): Promise<BackendLogSnapshot> =>
    ipcRenderer.invoke("zhishi:get-backend-logs"),
  clearBackendLogs: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("zhishi:clear-backend-logs"),
  openBackendLogFile: (): Promise<{ ok: boolean; message?: string }> =>
    ipcRenderer.invoke("zhishi:open-backend-log-file"),
  onBackendLog: (handler: (line: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, line: string) => handler(line)
    ipcRenderer.on("zhishi:backend-log", listener)
    return () => {
      ipcRenderer.removeListener("zhishi:backend-log", listener)
    }
  },
})
