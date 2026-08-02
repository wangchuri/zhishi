import { app, BrowserWindow, shell } from "electron"
import * as fs from "fs"
import * as http from "http"
import * as path from "path"

const DEV = process.argv.includes("--dev")
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173"

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
}

/**
 * 生产模式在本机起一个仅监听 127.0.0.1 的静态服务器托管 dist，
 * 这样 SPA 路由（BrowserRouter）与相对路径资源在打包后仍能正常工作。
 */
function startStaticServer(): Promise<number> {
  const root = path.join(__dirname, "..", "..", "dist")
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0])
    let filePath = path.join(root, urlPath === "/" ? "index.html" : urlPath)

    if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(root, "index.html")
    }

    const ext = path.extname(filePath)
    res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream")
    fs.createReadStream(filePath).pipe(res)
  })

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      resolve(typeof address === "object" && address ? address.port : 8080)
    })
  })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    backgroundColor: "#F3EFE6",
    icon: path.join(__dirname, "..", "..", "public", "logo.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url)
    }
    return { action: "deny" }
  })

  if (DEV) {
    win.loadURL(DEV_SERVER_URL)
  } else {
    startStaticServer().then((port) => win.loadURL(`http://127.0.0.1:${port}/`))
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
