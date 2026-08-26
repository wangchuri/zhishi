/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface ZhishiBackendLogSnapshot {
  lines: string[]
  logFile: string
  managed: boolean
  running: boolean
}

interface ZhishiDesktopBridge {
  isElectron: boolean
  platform: string
  backendUrl?: string
  versions?: { electron?: string; chrome?: string }
  getBackendLogs?: () => Promise<ZhishiBackendLogSnapshot>
  clearBackendLogs?: () => Promise<{ ok: boolean }>
  openBackendLogFile?: () => Promise<{ ok: boolean; message?: string }>
  onBackendLog?: (handler: (line: string) => void) => () => void
}

interface Window {
  zhishi?: ZhishiDesktopBridge
}
