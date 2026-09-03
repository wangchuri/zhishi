import { PanelRightClose, PanelRightOpen } from "lucide-react"
import { ChatFunctionPlot, type ChatPlotPayload } from "@/features/chat/ChatFunctionPlot"
import { cn } from "@/lib/utils"

export function ChatPlotSidebar({
  open,
  onOpenChange,
  plot,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  plot: ChatPlotPayload | null
}) {
  return (
    <div
      className={cn(
        "shrink-0 border-l border-line-soft bg-surface/60 flex flex-col transition-all duration-200",
        open ? "w-[min(100%,460px)]" : "w-[44px]",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-3 border-b border-line-soft",
          !open && "justify-center px-0",
        )}
      >
        {open && (
          <span className="text-card-title font-semibold text-ink-primary flex-1 truncate">
            {plot?.title?.trim() || "画布"}
          </span>
        )}
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          className="w-7 h-7 rounded-md flex items-center justify-center text-ink-tertiary hover:text-ink-primary hover:bg-surface-soft transition-colors shrink-0"
          title={open ? "折叠画布" : "展开画布"}
        >
          {open ? (
            <PanelRightClose className="w-4 h-4" strokeWidth={2} />
          ) : (
            <PanelRightOpen className="w-4 h-4" strokeWidth={2} />
          )}
        </button>
      </div>

      {open ? (
        <div className="flex-1 overflow-y-auto scroll-thin p-4">
          {!plot ? (
            <div className="text-small text-ink-tertiary text-center py-12 px-2 leading-relaxed">
              Tina 画出函数图后会显示在这里。也可以点对话里的画布卡片重新打开。
            </div>
          ) : (
            <ChatFunctionPlot plot={plot} />
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
