import { memo, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { HEIGHT_MESSAGE, MAX_HEIGHT, REFIT_MESSAGE, wrapInlineHtml } from "./inlineHtmlDoc"

/**
 * 把 ```html 代码块渲染成沙箱 HTML（聊天消息里内联显示）。
 * 和「画布」不同：这里只做简单图案/示意图，不提供缩放、不占用右侧面板。
 */
export const InlineHtmlFrame = memo(function InlineHtmlFrame({
  html,
  className,
}: {
  html: string
  className?: string
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(120)

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; height?: number } | null
      if (!d || d.type !== HEIGHT_MESSAGE) return
      const h = Number(d.height)
      if (!Number.isFinite(h) || h <= 0) return
      setHeight(Math.min(MAX_HEIGHT + 8, Math.max(32, Math.ceil(h))))
    }
    window.addEventListener("message", onMsg)
    return () => window.removeEventListener("message", onMsg)
  }, [])

  // 宽度变了（旋转屏幕、键盘弹出、桌面拖宽窗口、面板换位）要重新算缩放，
  // 否则内容还按旧宽度缩放，就会溢出 iframe。
  useEffect(() => {
    const el = iframeRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    let lastW = 0
    const ro = new ResizeObserver(() => {
      const w = Math.round(el.getBoundingClientRect().width)
      if (w <= 0 || w === lastW) return
      lastW = w
      el.contentWindow?.postMessage({ type: REFIT_MESSAGE }, "*")
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <iframe
      ref={iframeRef}
      title="内联图示"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={wrapInlineHtml(html, MAX_HEIGHT)}
      className={cn(
        "block w-full max-w-full overflow-hidden rounded-md border border-line-soft bg-paper/60",
        className,
      )}
      style={{ height }}
    />
  )
})
