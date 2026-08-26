import { useEffect } from "react"
import { analyticsApi } from "@/lib/api"

const IDLE_MS = 120_000 // 无交互超时，停止计时
const FLUSH_EVERY_SEC = 30 // 每累计 30s 上报一次
const MAX_FLUSH_SEC = 90 // 单次上报上限

/**
 * 活跃时长埋点：页面可见且有交互时计时，每 30s 上报一次心跳。
 * 页面隐藏 / 长时间无操作自动暂停；卸载时把剩余秒数刷掉。
 */
export function useActiveTime() {
  useEffect(() => {
    let accSeconds = 0
    let idle = false
    let lastActivity = Date.now()

    const markActive = () => {
      idle = false
      lastActivity = Date.now()
    }

    const flush = () => {
      if (accSeconds <= 0) return
      analyticsApi.reportActivity(Math.min(accSeconds, MAX_FLUSH_SEC)).catch(() => {})
      accSeconds = 0
    }

    const tick = () => {
      if (Date.now() - lastActivity > IDLE_MS) idle = true
      if (document.visibilityState === "visible" && !idle) {
        accSeconds += 1
      }
      if (accSeconds >= FLUSH_EVERY_SEC) flush()
    }

    const ticker = window.setInterval(tick, 1000)
    const onVisibility = () => flush()
    const onUnload = () => flush()

    const events: Array<keyof WindowEventMap> = [
      "pointerdown",
      "keydown",
      "pointermove",
      "touchstart",
    ]
    events.forEach((ev) => window.addEventListener(ev, markActive, { passive: true }))
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("beforeunload", onUnload)

    return () => {
      flush()
      window.clearInterval(ticker)
      events.forEach((ev) => window.removeEventListener(ev, markActive))
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("beforeunload", onUnload)
    }
  }, [])
}
