// 给 Capacitor 生成的 AndroidManifest 打开明文 HTTP。
//
// 为什么需要：知拾后端只有 HTTP，Capacitor 用 server.url 直接加载 http:// 地址。
// 但 Android API 28+ 默认禁止明文流量，而 Capacitor 只在「有 Cordova 插件」时才写
// android:usesCleartextTraffic。纯 Capacitor 工程不加会白屏
// （net::ERR_CLEARTEXT_NOT_PERMITTED）。
//
// 幂等：已存在则跳过。用法：node scripts/enable-android-cleartext.mjs [manifest 路径]
import { readFileSync, writeFileSync } from "node:fs"

const file = process.argv[2] || "android/app/src/main/AndroidManifest.xml"
let xml = readFileSync(file, "utf8")

if (xml.includes("android:usesCleartextTraffic")) {
  console.log(`[cleartext] 已有 usesCleartextTraffic，跳过：${file}`)
  process.exit(0)
}
if (!/<application\b/.test(xml)) {
  console.error(`[cleartext] 未找到 <application>，无法打补丁：${file}`)
  process.exit(1)
}

xml = xml.replace(
  /<application\b/,
  '<application\n        android:usesCleartextTraffic="true"',
)
writeFileSync(file, xml)
console.log(`[cleartext] 已写入 android:usesCleartextTraffic="true"：${file}`)
