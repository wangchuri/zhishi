import { app, BrowserWindow, dialog, ipcMain, shell } from "electron"
import { ChildProcess, spawn } from "child_process"
import * as fs from "fs"
import * as http from "http"
import * as path from "path"

const DEV = process.argv.includes("--dev")
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173"
const BACKEND_URL = (process.env.ZHISHI_BACKEND_URL || "http://127.0.0.1:7777").replace(/\/+$/, "")
const HEALTH_URL = `${BACKEND_URL}/health`
const MAX_LOG_LINES = 4000

let mainWindow: BrowserWindow | null = null
let backendProcess: ChildProcess | null = null
let weStartedBackend = false
let logFilePath = ""
const logLines: string[] = []
let stdoutBuf = ""
let stderrBuf = ""

function repoRoot(): string {
  return path.resolve(__dirname, "..", "..", "..")
}

function iconPath(): string {
  const candidates = [
    path.join(__dirname, "..", "..", "public", "logo.png"),
    path.join(process.resourcesPath || "", "logo.png"),
  ]
  return candidates.find((p) => fs.existsSync(p)) || candidates[0]
}

function resolveLogFile(cwd: string): string {
  return path.join(cwd, "zhishi-backend.log")
}

function pushLog(line: string, stream: "out" | "err" | "sys" = "sys"): void {
  const text = line.replace(/\r$/, "")
  if (!text.trim()) return
  const stamped = `[${new Date().toISOString().slice(11, 19)}][${stream}] ${text}`
  logLines.push(stamped)
  if (logLines.length > MAX_LOG_LINES) {
    logLines.splice(0, logLines.length - MAX_LOG_LINES)
  }
  try {
    if (logFilePath) fs.appendFileSync(logFilePath, stamped + "\n", "utf8")
  } catch {
    /* ignore disk errors */
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("zhishi:backend-log", stamped)
  }
}

function attachStreamCapture(proc: ChildProcess): void {
  const onChunk = (chunk: Buffer | string, stream: "out" | "err") => {
    const raw = typeof chunk === "string" ? chunk : chunk.toString("utf8")
    if (stream === "out") {
      stdoutBuf += raw
      const parts = stdoutBuf.split(/\r?\n/)
      stdoutBuf = parts.pop() || ""
      for (const line of parts) pushLog(line, "out")
    } else {
      stderrBuf += raw
      const parts = stderrBuf.split(/\r?\n/)
      stderrBuf = parts.pop() || ""
      for (const line of parts) pushLog(line, "err")
    }
  }
  proc.stdout?.on("data", (c) => onChunk(c, "out"))
  proc.stderr?.on("data", (c) => onChunk(c, "err"))
}

function appDir(): string {
  // 打包后：Zhishi.exe 所在目录；开发：仓库 frontend/
  if (app.isPackaged) return path.dirname(app.getPath("exe"))
  return path.resolve(__dirname, "..", "..")
}

function resolveBackendLaunch():
  | { kind: "exe"; exe: string; cwd: string }
  | { kind: "python"; python: string; cwd: string }
  | null {
  const packaged = app.isPackaged
  const dir = appDir()
  // 约定：后端 exe 与前端 exe 放在一起（旁路目录），不打进 Electron 包
  const exeCandidates = [
    process.env.ZHISHI_BACKEND_EXE,
    path.join(dir, "zhishi-backend", "zhishi-backend.exe"),
    path.join(dir, "zhishi-backend.exe"),
    // 开发：仓库 desktop/zhishi-backend
    path.join(repoRoot(), "desktop", "zhishi-backend", "zhishi-backend.exe"),
    // 万一有人仍放在 resources 里
    path.join(process.resourcesPath || "", "zhishi-backend", "zhishi-backend.exe"),
  ].filter(Boolean) as string[]

  for (const exe of exeCandidates) {
    if (fs.existsSync(exe)) {
      return { kind: "exe", exe, cwd: path.dirname(exe) }
    }
  }

  if (packaged) return null

  const pyCandidates = [
    process.env.ZHISHI_PYTHON,
    path.join(repoRoot(), ".venv", "Scripts", "python.exe"),
    path.join(repoRoot(), "venv", "Scripts", "python.exe"),
  ].filter(Boolean) as string[]

  for (const python of pyCandidates) {
    if (fs.existsSync(python)) {
      return {
        kind: "python",
        python,
        cwd: path.join(repoRoot(), "backend"),
      }
    }
  }
  return null
}

function checkHealth(timeoutMs = 2500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_URL, { timeout: timeoutMs }, (res) => {
      res.resume()
      resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300)
    })
    req.on("error", () => resolve(false))
    req.on("timeout", () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function waitForBackend(maxMs = 180_000): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < maxMs) {
    if (await checkHealth()) return true
    await new Promise((r) => setTimeout(r, 800))
  }
  return false
}

function tryStartBackend(): { ok: boolean; detail: string } {
  if (backendProcess) return { ok: true, detail: "already running" }

  const launch = resolveBackendLaunch()
  if (!launch) {
    return {
      ok: false,
      detail:
        "未找到 zhishi-backend.exe。\n请把它放在 Zhishi.exe 同目录下的 zhishi-backend\\ 里。",
    }
  }

  try {
    logFilePath = resolveLogFile(launch.cwd)
    try {
      fs.writeFileSync(logFilePath, `--- zhishi backend ${new Date().toISOString()} ---\n`, "utf8")
    } catch {
      /* ignore */
    }

    const env = {
      ...process.env,
      ZHISHI_DESKTOP: "1",
      PYTHONUNBUFFERED: "1",
      PYTHONIOENCODING: "utf-8",
    }

    pushLog(`启动后端: ${launch.kind === "exe" ? launch.exe : launch.python}`, "sys")
    pushLog(`工作目录: ${launch.cwd}`, "sys")
    pushLog(`日志文件: ${logFilePath}`, "sys")

    if (launch.kind === "exe") {
      // console=True 的 exe + windowsHide：无黑窗，但仍可捕获 stdout
      backendProcess = spawn(launch.exe, [], {
        cwd: launch.cwd,
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      })
    } else {
      backendProcess = spawn(launch.python, ["-m", "src.main"], {
        cwd: launch.cwd,
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      })
    }
    weStartedBackend = true
    attachStreamCapture(backendProcess)
    backendProcess.on("error", (err) => {
      pushLog(`进程错误: ${err.message}`, "err")
    })
    backendProcess.on("exit", (code, signal) => {
      pushLog(`后端已退出 code=${code} signal=${signal ?? ""}`, "sys")
      backendProcess = null
      weStartedBackend = false
    })
    return {
      ok: true,
      detail: launch.kind === "exe" ? launch.exe : launch.python,
    }
  } catch (e) {
    pushLog(`启动失败: ${e}`, "err")
    return { ok: false, detail: String(e) }
  }
}

function stopBackendIfStarted(): void {
  if (!weStartedBackend || !backendProcess) return
  pushLog("正在停止后端…", "sys")
  try {
    if (process.platform === "win32" && backendProcess.pid) {
      spawn("taskkill", ["/pid", String(backendProcess.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      })
    } else {
      backendProcess.kill("SIGTERM")
    }
  } catch {
    /* ignore */
  }
  backendProcess = null
  weStartedBackend = false
}

function createSplash(): BrowserWindow {
  const win = new BrowserWindow({
    width: 420,
    height: 220,
    resizable: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: "#1A2E2D",
    icon: iconPath(),
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  const html = `<!doctype html><html><head><meta charset="utf-8">
<style>
  body{margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
  font-family:Segoe UI,system-ui,sans-serif;background:#1A2E2D;color:#F3EFE6}
  h1{font-size:22px;margin:0 0 8px;font-weight:600;letter-spacing:.04em}
  p{margin:0;opacity:.72;font-size:13px}
</style></head><body>
  <h1>知拾</h1>
  <p>正在启动本地服务…</p>
</body></html>`
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  return win
}

async function ensureBackendReady(splash: BrowserWindow): Promise<boolean> {
  if (await checkHealth()) {
    pushLog("检测到本机后端已在运行，跳过拉起", "sys")
    return true
  }

  const started = tryStartBackend()
  if (!started.ok) {
    if (!splash.isDestroyed()) {
      await dialog.showMessageBox(splash, {
        type: "error",
        title: "知拾",
        message: "无法启动本机后端",
        detail: started.detail + (logLines.length ? `\n\n最近日志：\n${logLines.slice(-20).join("\n")}` : ""),
      })
    }
    return false
  }

  const ok = await waitForBackend(180_000)
  if (!ok && !splash.isDestroyed()) {
    await dialog.showMessageBox(splash, {
      type: "error",
      title: "知拾",
      message: "后端启动超时",
      detail:
        `已尝试启动：\n${started.detail}\n日志：${logFilePath || "(无)"}\n\n` +
        `最近输出：\n${logLines.slice(-40).join("\n") || "(暂无)"}`,
    })
  }
  return ok
}

function registerIpc(): void {
  ipcMain.handle("zhishi:get-backend-logs", () => ({
    lines: [...logLines],
    logFile: logFilePath,
    managed: weStartedBackend,
    running: Boolean(backendProcess),
  }))
  ipcMain.handle("zhishi:clear-backend-logs", () => {
    logLines.length = 0
    pushLog("（日志已清空）", "sys")
    return { ok: true }
  })
  ipcMain.handle("zhishi:open-backend-log-file", async () => {
    if (!logFilePath || !fs.existsSync(logFilePath)) {
      return { ok: false, message: "日志文件尚不存在" }
    }
    const err = await shell.openPath(logFilePath)
    return { ok: !err, message: err || "" }
  })
}

async function createWindow(): Promise<void> {
  const splash = createSplash()

  const ready = await ensureBackendReady(splash)
  if (!ready) {
    if (!splash.isDestroyed()) splash.close()
    app.quit()
    return
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    backgroundColor: "#F3EFE6",
    icon: iconPath(),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url)
    }
    return { action: "deny" }
  })

  const target = DEV ? DEV_SERVER_URL : `${BACKEND_URL}/`
  await mainWindow.loadURL(target)
  mainWindow.show()
  if (!splash.isDestroyed()) splash.close()

  mainWindow.on("closed", () => {
    mainWindow = null
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    registerIpc()
    void createWindow()
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow()
    })
  })
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", () => {
  stopBackendIfStarted()
})
