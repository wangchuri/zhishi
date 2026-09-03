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

export function wrapCanvasHtml(fragment: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<style>
  html,body{height:100%;margin:0;padding:10px;box-sizing:border-box;overflow:hidden;background:#F3EFE6;color:#14212B;font-family:ui-sans-serif,system-ui,sans-serif;font-size:14px;}
  body{display:flex;flex-direction:column;gap:8px;min-height:0;}
  canvas,svg{display:block;max-width:100%;max-height:100%;flex:1 1 auto;}
</style>
</head>
<body>${fragment}</body>
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
  const title =
    item?.type === "plot"
      ? item.plot.title?.trim() || "函数图"
      : item?.type === "html"
        ? item.canvas.title?.trim() || "画布"
        : "画布"

  return (
    <div
      className={cn(
        "shrink-0 border-l border-line-soft bg-surface/60 flex flex-col min-h-0 h-full transition-all duration-200",
        open ? "w-[min(100%,520px)]" : "w-[44px]",
      )}
    >
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
