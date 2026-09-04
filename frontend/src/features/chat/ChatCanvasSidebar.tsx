import { useCallback, useEffect, useRef, useState } from "react"
import { PanelRightClose, PanelRightOpen } from "lucide-react"
import { ChatFunctionPlot, type ChatPlotPayload } from "@/features/chat/ChatFunctionPlot"
import { cn } from "@/lib/utils"

export type ChatHtmlCanvas = {
  id: string
  title?: string | null
  html: string
}

export type ChatCanvasItem =
  | { type: "plot"; plot: ChatPlotPayload }
  | { type: "html"; canvas: ChatHtmlCanvas }

const CSP =
  "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:;"

const WIDTH_KEY = "zhishi.chat.canvasWidth"
const WIDTH_DEFAULT = 420
const WIDTH_MIN = 280
const WIDTH_MAX_VIEW_DESKTOP = 0.72
const WIDTH_MAX_VIEW_NARROW = 0.92

function readStoredWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY))
    if (Number.isFinite(n) && n >= WIDTH_MIN) return Math.round(n)
  } catch {
    /* ignore */
  }
  return WIDTH_DEFAULT
}

function maxWidthForViewport(): number {
  const ratio = window.innerWidth < 1024 ? WIDTH_MAX_VIEW_NARROW : WIDTH_MAX_VIEW_DESKTOP
  return Math.max(WIDTH_MIN + 40, Math.floor(window.innerWidth * ratio))
}

function clampWidth(px: number): number {
  return Math.min(maxWidthForViewport(), Math.max(WIDTH_MIN, Math.round(px)))
}

/** 过大时整体等比缩小；不做属性监听，避免 transform 改写死循环卡死。 */
export function wrapCanvasHtml(fragment: string): string {
  const fitScript = `(function(){
  var root=document.getElementById('zhishi-fit');
  if(!root) return;
  var busy=false;
  var last=1;
  function layout(){
    if(busy) return;
    busy=true;
    try{
      root.style.transform='none';
      var pad=20;
      var availW=Math.max(1, window.innerWidth-pad);
      var availH=Math.max(1, window.innerHeight-pad);
      var w=Math.max(root.scrollWidth, root.offsetWidth, 1);
      var h=Math.max(root.scrollHeight, root.offsetHeight, 1);
      var s=Math.min(1, availW/w, availH/h);
      if(Math.abs(s-last)<0.01) return;
      last=s;
      root.style.transformOrigin='top center';
      root.style.transform=s<0.995?('scale('+s+')'):'none';
    }finally{
      busy=false;
    }
  }
  window.addEventListener('resize', function(){ last=-1; layout(); });
  if(window.MutationObserver){
    try{
      new MutationObserver(function(){ last=-1; setTimeout(layout, 0); }).observe(root,{childList:true,subtree:true});
    }catch(e){}
  }
  setTimeout(layout, 0);
  setTimeout(layout, 120);
  setTimeout(layout, 400);
  setTimeout(layout, 1000);
})();`

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<style>
  html,body{height:100%;margin:0;padding:0;box-sizing:border-box;overflow:auto;background:#F3EFE6;color:#14212B;font-family:ui-sans-serif,system-ui,sans-serif;font-size:14px;}
  body{margin:0;padding:10px;box-sizing:border-box;}
  #zhishi-fit{display:block;width:max-content;max-width:100%;margin:0 auto;box-sizing:border-box;}
  #zhishi-fit canvas,#zhishi-fit svg,#zhishi-fit img{
    display:block;
    max-width:100%;
    max-height:calc(100vh - 24px);
  }
</style>
</head>
<body>
<div id="zhishi-fit">${fragment}</div>
<script>${fitScript}<\/script>
</body>
</html>`
}

export function ChatHtmlFrame({ canvas }: { canvas: ChatHtmlCanvas }) {
  return (
    <iframe
      title={canvas.title || "画布"}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={wrapCanvasHtml(canvas.html || "")}
      className="block w-full h-full min-h-0 rounded-[12px] border border-line bg-paper"
    />
  )
}

export function ChatCanvasSidebar({
  open,
  onOpenChange,
  item,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: ChatCanvasItem | null
}) {
  const [width, setWidth] = useState(WIDTH_DEFAULT)
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)

  useEffect(() => {
    setWidth(clampWidth(readStoredWidth()))
  }, [])

  useEffect(() => {
    const onResize = () => setWidth((w) => clampWidth(w))
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  const onDragMove = useCallback((e: MouseEvent) => {
    const drag = dragRef.current
    if (!drag) return
    // 从左侧边缘向左拖 → 变宽；向右拖 → 变窄
    const next = clampWidth(drag.startW + (drag.startX - e.clientX))
    setWidth(next)
  }, [])

  const onDragEnd = useCallback(() => {
    dragRef.current = null
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
    window.removeEventListener("mousemove", onDragMove)
    window.removeEventListener("mouseup", onDragEnd)
    setWidth((w) => {
      const next = clampWidth(w)
      try {
        localStorage.setItem(WIDTH_KEY, String(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [onDragMove])

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startW: width }
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    window.addEventListener("mousemove", onDragMove)
    window.addEventListener("mouseup", onDragEnd)
  }

  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", onDragMove)
      window.removeEventListener("mouseup", onDragEnd)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
  }, [onDragMove, onDragEnd])

  const title =
    item?.type === "plot"
      ? item.plot.title?.trim() || "函数图"
      : item?.type === "html"
        ? item.canvas.title?.trim() || "画布"
        : "画布"

  return (
    <div
      className={cn(
        "relative shrink-0 border-l border-line-soft bg-surface/60 flex flex-col min-h-0 h-full",
        !open && "transition-[width] duration-200",
      )}
      style={{ width: open ? width : 44 }}
    >
      {open ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整画布宽度"
          title="拖动调整宽度"
          onMouseDown={onDragStart}
          className={cn(
            "absolute left-0 top-0 bottom-0 z-20 w-1.5 -translate-x-1/2 cursor-col-resize",
            "group flex items-center justify-center",
          )}
        >
          <span className="h-10 w-1 rounded-full bg-line-soft group-hover:bg-sea/50 group-active:bg-sea transition-colors" />
        </div>
      ) : null}

      <div
        className={cn(
          "flex items-center gap-2 px-3 py-3 border-b border-line-soft",
          !open && "justify-center px-0",
        )}
      >
        {open && (
          <span className="text-card-title font-semibold text-ink-primary flex-1 truncate">{title}</span>
        )}
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          className="w-7 h-7 rounded-md flex items-center justify-center text-ink-tertiary hover:text-ink-primary hover:bg-surface-soft transition-colors shrink-0"
          title={open ? "折叠画布" : "展开画布"}
        >
          {open ? <PanelRightClose className="w-4 h-4" strokeWidth={2} /> : <PanelRightOpen className="w-4 h-4" strokeWidth={2} />}
        </button>
      </div>

      {open ? (
        <div
          className={cn(
            "flex-1 min-h-0 p-3",
            item?.type === "html" ? "flex flex-col overflow-hidden" : "overflow-y-auto scroll-thin",
          )}
        >
          {!item ? (
            <div className="text-small text-ink-tertiary text-center py-12 px-2 leading-relaxed">
              Tina 画出图像后会显示在这里。也可以点对话里的画布卡片重新打开。
            </div>
          ) : item.type === "plot" ? (
            <ChatFunctionPlot plot={item.plot} />
          ) : (
            <ChatHtmlFrame canvas={item.canvas} />
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <button
            type="button"
            onClick={() => onOpenChange(true)}
            className="flex flex-col items-center gap-1.5 text-ink-tertiary hover:text-primary transition-colors py-8"
            title="展开画布"
          >
            <PanelRightOpen className="w-4 h-4" strokeWidth={2} />
            <span className="text-caption font-medium [writing-mode:vertical-rl] tracking-wider">画布</span>
          </button>
        </div>
      )}
    </div>
  )
}
