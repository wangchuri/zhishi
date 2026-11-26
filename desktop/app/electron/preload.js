"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld("zhishi", {
    isElectron: true,
    platform: process.platform,
    backendUrl: process.env.ZHISHI_BACKEND_URL || "http://127.0.0.1:7777",
    versions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
    },
    getBackendLogs: () => electron_1.ipcRenderer.invoke("zhishi:get-backend-logs"),
    clearBackendLogs: () => electron_1.ipcRenderer.invoke("zhishi:clear-backend-logs"),
    openBackendLogFile: () => electron_1.ipcRenderer.invoke("zhishi:open-backend-log-file"),
    onBackendLog: (handler) => {
        const listener = (_event, line) => handler(line);
        electron_1.ipcRenderer.on("zhishi:backend-log", listener);
        return () => {
            electron_1.ipcRenderer.removeListener("zhishi:backend-log", listener);
        };
    },
});
