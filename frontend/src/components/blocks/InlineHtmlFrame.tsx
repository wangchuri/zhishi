import { memo, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

const CSP =
  "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:;"

/** 内联图示的最大显示高度：超过就整体缩小，不出滚动条 */
const MAX_HEIGHT = 460

/**
 * 内联 HTML 片段：沙箱 iframe + 自动缩放（聊天流里的小图案/示意图）。
 *
 * 内容超过可用宽/高时按比例缩小到装下，**不出现滚动条**——
 * 内联小图出现滚动条体验很差，宁可整体缩一点。
 */
function wrapInlineHtml(fragment: string, maxHeight: number): string {
  const fitScript = `(function(){
  var root=document.getElementById('zhishi-inline-fit');
  if(!root) return;
  var MAX_H=${maxHeight};
  var lastW=-1, lastH=-1;
  function fit(){
    root.style.transform='none';
    // 每次量之前先把 body 尺寸放开：否则上一轮设过的宽高会把可用宽度越算越小
    document.body.style.width='auto';
    document.body.style.height='auto';
    var availW=Math.max(1, window.innerWidth);
    var w=Math.max(root.scrollWidth, root.offsetWidth, 1);
    var h=Math.max(root.scrollHeight, root.offsetHeight, 1);
    var scale=Math.min(1, availW/w, MAX_H/h);
    if(!isFinite(scale)||scale<=0) scale=1;
    root.style.transformOrigin='top left';
    root.style.transform = scale<1 ? 'scale('+scale+')' : 'none';
    var shownW=Math.max(1, Math.ceil(w*scale));
    var shownH=Math.max(1, Math.ceil(h*scale));
    document.body.style.width=shownW+'px';
    document.body.style.height=shownH+'px';
    if(shownW===lastW && shownH===lastH) return;
    lastW=shownW; lastH=shownH;
    try{ parent.postMessage({type:'zhishi-inline-html-height', height:shownH}, '*'); }catch(e){}
  }
  window.addEventListener('load', fit);
  if(window.ResizeObserver){
    try{ new ResizeObserver(fit).observe(root); }catch(e){}
  }
  setTimeout(fit, 0);
  setTimeout(fit, 120);
  setTimeout(fit, 400);
})();`

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<style>
  html,body{margin:0;padding:0;overflow:hidden;background:transparent;color:#14212B;
    font-family:ui-sans-serif,system-ui,sans-serif;font-size:14px;line-height:1.5;}
  #zhishi-inline-fit{display:inline-block;vertical-align:top;}
  img,svg,canvas{max-width:100%;height:auto;display:block;margin:0 auto;}
  table{border-collapse:collapse;} td,th{padding:2px 6px;}
</style>
</head>
<body><div id="zhishi-inline-fit">${fragment}</div>
<script>${fitScript}</script>
</body>
</html>`
}

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
      if (!d || d.type !== "zhishi-inline-html-height") return
      const h = Number(d.height)
      if (!Number.isFinite(h) || h <= 0) return
      setHeight(Math.min(MAX_HEIGHT + 8, Math.max(32, Math.ceil(h))))
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
      srcDoc={wrapInlineHtml(html, MAX_HEIGHT)}
      className={cn("block w-full rounded-md border border-line-soft bg-paper/60", className)}
      style={{ height }}
    />
  )
})
