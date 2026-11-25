import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

const CSP =
  "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:;"

/** 内联 HTML 片段：沙箱 iframe + 高度自适应（聊天流里的小图案/示意图） */
function wrapInlineHtml(fragment: string): string {
  const report = `(function(){
  function post(){
    var h=Math.max(
      document.body?document.body.scrollHeight:0,
      document.documentElement?document.documentElement.scrollHeight:0
    );
    try{ parent.postMessage({type:'zhishi-inline-html-height', height:h}, '*'); }catch(e){}
  }
  window.addEventListener('load', post);
  if(window.ResizeObserver){
    try{ new ResizeObserver(post).observe(document.body); }catch(e){}
  }
  setTimeout(post, 0);
  setTimeout(post, 120);
  setTimeout(post, 400);
})();`

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<style>
  html,body{margin:0;padding:0;background:transparent;color:#14212B;
    font-family:ui-sans-serif,system-ui,sans-serif;font-size:14px;line-height:1.5;}
  body{padding:2px 0;}
  img,svg,canvas{max-width:100%;height:auto;display:block;margin:0 auto;}
  table{border-collapse:collapse;} td,th{padding:2px 6px;}
</style>
</head>
<body>${fragment}
<script>${report}<\/script>
</body>
</html>`
}

/**
 * 把 ```html 代码块渲染成沙箱 HTML（聊天消息里内联显示）。
 * 和「画布」不同：这里只做简单图案/示意图，不提供缩放、不占用右侧面板。
 */
export function InlineHtmlFrame({ html, className }: { html: string; className?: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(120)

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; height?: number } | null
      if (!d || d.type !== "zhishi-inline-html-height") return
      const h = Number(d.height)
      if (!Number.isFinite(h) || h <= 0) return
      setHeight(Math.min(1600, Math.max(40, Math.ceil(h))))
    }
    window.addEventListener("message", onMsg)
    return () => window.removeEventListener("message", onMsg)
  }, [])

  return (
    <iframe
      ref={iframeRef}
      title="内联图示"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={wrapInlineHtml(html)}
      className={cn("block w-full rounded-md border border-line-soft bg-paper/60", className)}
      style={{ height }}
    />
  )
}
