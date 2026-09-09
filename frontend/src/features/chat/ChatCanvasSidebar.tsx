import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft, LineChart, Minus, PanelRightClose, PanelRightOpen, PencilRuler, Plus, RotateCcw } from "lucide-react"
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

const ZOOM_MIN = 0.5
const ZOOM_MAX = 3
const ZOOM_STEP = 0.25

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

function clampZoom(z: number): number {
  const n = Math.round(z / ZOOM_STEP) * ZOOM_STEP
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(n.toFixed(2))))
}

/** 默认按视口适配；支持父页 postMessage 调整 userZoom，并可滚轮 Ctrl 缩放。 */
export function wrapCanvasHtml(fragment: string): string {
  const fitScript = `(function(){
  var root=document.getElementById('zhishi-fit');
  var host=document.getElementById('zhishi-host');
  if(!root||!host) return;
  var busy=false;
  var last=-1;
  var userZoom=1;
  function layout(){
    if(busy) return;
    busy=true;
    try{
      root.style.transform='none';
      host.style.width='auto';
      host.style.height='auto';
      var pad=16;
      var availW=Math.max(1, window.innerWidth-pad);
      var availH=Math.max(1, window.innerHeight-pad);
      var w=Math.max(root.scrollWidth, root.offsetWidth, 1);
      var h=Math.max(root.scrollHeight, root.offsetHeight, 1);
      var fit=Math.min(1, availW/w, availH/h);
      if(!isFinite(fit)||fit<=0) fit=1;
      var s=fit*userZoom;
      if(Math.abs(s-last)<0.005) return;
      last=s;
      root.style.transformOrigin='top left';
      root.style.transform='scale('+s+')';
      host.style.width=Math.ceil(w*s)+'px';
      host.style.height=Math.ceil(h*s)+'px';
    }finally{
      busy=false;
    }
  }
  function setZoom(z){
    if(typeof z!=='number'||!isFinite(z)) return;
    userZoom=Math.min(3, Math.max(0.5, z));
    last=-1;
    layout();
  }
  window.addEventListener('message', function(e){
    var d=e&&e.data;
    if(!d||d.type!=='zhishi-canvas-zoom') return;
    setZoom(Number(d.zoom));
  });
  window.addEventListener('wheel', function(e){
    if(!(e.ctrlKey||e.metaKey)) return;
    e.preventDefault();
    var next=userZoom*(e.deltaY<0?1.1:1/1.1);
    setZoom(next);
    try{ parent.postMessage({type:'zhishi-canvas-zoom-changed', zoom:userZoom}, '*'); }catch(err){}
  }, {passive:false});
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
  body{margin:0;padding:8px;box-sizing:border-box;}
  #zhishi-host{position:relative;margin:0 auto;}
  #zhishi-fit{display:block;width:max-content;box-sizing:border-box;}
  #zhishi-fit canvas,#zhishi-fit svg,#zhishi-fit img{
    display:block;
    max-width:none;
    max-height:none;
  }
</style>
</head>
<body>
<div id="zhishi-host"><div id="zhishi-fit">${fragment}</div></div>
<script>${fitScript}<\/script>
</body>
</html>`
}

export function ChatHtmlFrame({
  canvas,
  zoom,
  onZoomChange,
}: {
  canvas: ChatHtmlCanvas
  zoom: number
  onZoomChange?: (zoom: number) => void
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const postZoom = useCallback((z: number) => {
    const win = iframeRef.current?.contentWindow
    if (!win) return
    win.postMessage({ type: "zhishi-canvas-zoom", zoom: z }, "*")
  }, [])

  useEffect(() => {
    postZoom(zoom)
  }, [zoom, canvas.id, postZoom])

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data
      if (!d || d.type !== "zhishi-canvas-zoom-changed") return
      const z = Number(d.zoom)
      if (!Number.isFinite(z)) return
      onZoomChange?.(clampZoom(z))
    }
    window.addEventListener("message", onMsg)
    return () => window.removeEventListener("message", onMsg)
  }, [onZoomChange])

  return (
    <iframe
      ref={iframeRef}
      title={canvas.title || "画布"}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={wrapCanvasHtml(canvas.html || "")}
      onLoad={() => postZoom(zoom)}
      className="block w-full h-full min-h-0 rounded-[12px] border border-line bg-paper"
    />
  )
}

function ZoomToolbar({
  zoom,
  onZoomChange,
}: {
  zoom: number
  onZoomChange: (zoom: number) => void
}) {
  return (
    <div className="flex items-center gap-0.5 shrink-0 rounded-md border border-line-soft bg-paper px-0.5 py-0.5">
      <button
        type="button"
        title="缩小"
        disabled={zoom <= ZOOM_MIN}
        onClick={() => onZoomChange(clampZoom(zoom - ZOOM_STEP))}
        className="w-6 h-6 rounded flex items-center justify-center text-ink-secondary hover:text-ink-primary hover:bg-surface-soft disabled:opacity-40 disabled:pointer-events-none"
      >
        <Minus className="w-3.5 h-3.5" strokeWidth={2} />
      </button>
      <button
        type="button"
        title="点击恢复适应（100%）"
        onClick={() => onZoomChange(1)}
        className="min-w-[3rem] h-6 px-1 rounded text-caption font-medium text-ink-secondary hover:text-ink-primary hover:bg-surface-soft tabular-nums"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        title="放大"
        disabled={zoom >= ZOOM_MAX}
        onClick={() => onZoomChange(clampZoom(zoom + ZOOM_STEP))}
        className="w-6 h-6 rounded flex items-center justify-center text-ink-secondary hover:text-ink-primary hover:bg-surface-soft disabled:opacity-40 disabled:pointer-events-none"
      >
        <Plus className="w-3.5 h-3.5" strokeWidth={2} />
      </button>
      <button
        type="button"
        title="适应窗口"
        onClick={() => onZoomChange(1)}
        className="w-6 h-6 rounded flex items-center justify-center text-ink-secondary hover:text-ink-primary hover:bg-surface-soft"
      >
        <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />
      </button>
    </div>
  )
}

function canvasItemKey(item: ChatCanvasItem): string {
  return item.type === "plot" ? `plot:${item.plot.id}` : `html:${item.canvas.id}`
}

function canvasItemTitle(item: ChatCanvasItem): string {
  if (item.type === "plot") return item.plot.title?.trim() || "函数图"
  return item.canvas.title?.trim() || "交互画布"
}

function CanvasHistoryList({
  history,
  onSelect,
}: {
  history: ChatCanvasItem[]
  onSelect: (item: ChatCanvasItem) => void
}) {
  if (history.length === 0) {
    return (
      <div className="text-small text-ink-tertiary text-center py-12 px-2 leading-relaxed">
        本对话还没有画布。Tina 画出图像后会出现在这里，也可以点对话里的画布卡片打开。
      </div>
    )
  }

  // 新的在上，方便找最近画的
  const ordered = [...history].reverse()

  return (
    <div className="space-y-2">
      <p className="text-caption text-ink-tertiary px-0.5">
        本对话共 {history.length} 个画布（新→旧）
      </p>
      {ordered.map((item, i) => {
        const n = history.length - i
        const isPlot = item.type === "plot"
        return (
          <button
            key={canvasItemKey(item)}
            type="button"
            onClick={() => onSelect(item)}
            className="w-full text-left rounded-xl border border-line-soft bg-paper px-3 py-2.5 hover:border-sea/40 hover:bg-sea-subtle/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1 h-5 px-2 rounded-full text-[10px] font-semibold tracking-wide shrink-0",
                  isPlot ? "bg-warning/10 text-warning" : "bg-sea-subtle text-sea",
                )}
              >
                {isPlot ? (
                  <LineChart className="w-3 h-3" strokeWidth={2} />
                ) : (
                  <PencilRuler className="w-3 h-3" strokeWidth={2} />
                )}
                {isPlot ? "函数图" : "画布"}
              </span>
              <span className="text-caption text-ink-tertiary tabular-nums shrink-0">#{n}</span>
            </div>
            <div className="text-small font-medium text-ink-primary mt-1.5 line-clamp-2 leading-snug">
              {canvasItemTitle(item)}
            </div>
          </button>
        )
      })}
    </div>
  )
}

export function ChatCanvasSidebar({
  open,
  onOpenChange,
  item,
  history = [],
  onSelectItem,
  onBack,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: ChatCanvasItem | null
  /** 当前对话历史画布（早→晚） */
  history?: ChatCanvasItem[]
  onSelectItem?: (item: ChatCanvasItem) => void
  onBack?: () => void
}) {
  const [width, setWidth] = useState(WIDTH_DEFAULT)
  const [zoom, setZoom] = useState(1)
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)

  useEffect(() => {
    setWidth(clampWidth(readStoredWidth()))
  }, [])

  useEffect(() => {
    setZoom(1)
  }, [item?.type === "html" ? item.canvas.id : item?.type === "plot" ? item.plot.id : null])

  useEffect(() => {
    const onResize = () => setWidth((w) => clampWidth(w))
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  const onDragMove = useCallback((e: MouseEvent) => {
    const drag = dragRef.current
    if (!drag) return
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

  const viewing = !!item
  const title = viewing ? canvasItemTitle(item) : "画布列表"

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
          <>
            {viewing && onBack ? (
              <button
                type="button"
                onClick={onBack}
                className="w-7 h-7 rounded-md flex items-center justify-center text-ink-tertiary hover:text-ink-primary hover:bg-surface-soft transition-colors shrink-0"
                title="返回画布列表"
              >
                <ArrowLeft className="w-4 h-4" strokeWidth={2} />
              </button>
            ) : null}
            <span className="text-card-title font-semibold text-ink-primary flex-1 truncate min-w-0">{title}</span>
            {item?.type === "html" && (
              <ZoomToolbar zoom={zoom} onZoomChange={setZoom} />
            )}
          </>
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
            <CanvasHistoryList
              history={history}
              onSelect={(it) => onSelectItem?.(it)}
            />
          ) : item.type === "plot" ? (
            <ChatFunctionPlot plot={item.plot} />
          ) : (
            <ChatHtmlFrame canvas={item.canvas} zoom={zoom} onZoomChange={setZoom} />
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
