import { LineChart } from "lucide-react"
import type { ChatPlotPayload } from "@/features/chat/ChatFunctionPlot"

export function ChatPlotCard({
  plot,
  onOpen,
}: {
  plot: ChatPlotPayload
  onOpen?: (plot: ChatPlotPayload) => void
}) {
  const label = plot.title?.trim() || (plot.expressions || []).join("；") || "函数图"
  return (
    <button
      type="button"
      onClick={() => onOpen?.(plot)}
      className="mt-3 w-full max-w-[560px] text-left rounded-[18px] border border-line bg-paper px-4 py-3 shadow-[0_8px_24px_-8px_rgba(20,33,43,0.12)] hover:border-sea/40 transition-colors"
    >
      <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-sea-subtle text-sea text-[10px] font-semibold tracking-wide">
        <LineChart className="w-3 h-3" strokeWidth={2} />
        画布
      </span>
      <div className="font-display text-[15px] text-ink mt-2 leading-snug">{label}</div>
      <div className="text-[12px] text-ink-soft mt-1 font-mono truncate">
        {(plot.expressions || []).map((e) => `y = ${e}`).join(" · ")}
      </div>
      <div className="text-[11px] text-sea mt-2">在右侧查看图像</div>
    </button>
  )
}
