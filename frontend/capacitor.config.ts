import type { CapacitorConfig } from "@capacitor/cli"

/**
 * Android 壳（Capacitor）：WebView 直接加载知拾后端地址（同源模式）。
 *
 * 为什么不用「把 dist 打进 APK、让用户填地址」：
 * 知拾登录是 SameSite=Lax 的 cookie，且写请求有同源校验（backend/src/main.py）。
 * 跨源时 cookie 不发送、写请求 403 —— 那需要改后端。
 * 用 server.url 把页面 origin 变成后端 origin，登录与写操作全部照常，后端零改动；
 * 而且后端一更新，APK 打开就是最新版，无需重新打包。
 *
 * 地址在构建时注入，不写死进仓库：
 *   CAP_SERVER_URL=https://1.2.3.4:17777 npm run build
 * CI（.github/workflows/android-apk.yml）用仓库变量 ZHISHI_SERVER_URL 注入。
 *
 * 明文只在后端确实是 http:// 时才开（例如内网/Tailscale 隧道）；
 * 走 https（含 Let's Encrypt 的 IP 证书）时 cleartext 自动为 false，无需内置 CA。
 */
const serverUrl = (process.env.CAP_SERVER_URL || "").trim().replace(/\/+$/, "")

const config: CapacitorConfig = {
  appId: "com.zhishi.app",
  appName: "知拾",
  webDir: "dist",
  android: {
    // 与 PWA 一致的纸色，避免启动/回弹时闪白
    backgroundColor: "#F3EFE6",
  },
}

if (serverUrl) {
  config.server = {
    url: serverUrl,
    // 只有 http 后端才需要放行明文（https 时关掉更安全）
    cleartext: serverUrl.startsWith("http://"),
  }
}

export default config
