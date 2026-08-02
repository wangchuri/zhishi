import { contextBridge } from "electron"

contextBridge.exposeInMainWorld("zhishi", {
  isElectron: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
})
