import { PencilRuler } from "lucide-react"
import type { ChatHtmlCanvas } from "@/features/chat/ChatCanvasSidebar"

export function ChatHtmlCard({
  canvas,
  onOpen,
}: {
  canvas: ChatHtmlCanvas
  onOpen?: (canvas: ChatHtmlCanvas) => void
}) {
  const label = canvas.title?.trim() || "交互画布"
  return (
    <button
      type="button"
      onClick={() => onOpen?.(canvas)}
      className="mt-3 w-full max-w-[560px] text-left rounded-[18px] border border-line bg-paper px-4 py-3 shadow-[0_8px_24px_-8px_rgba(20,33,43,0.12)] hover:border-sea/40 transition-colors"
    >
      <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-sea-subtle text-sea text-[10px] font-semibold tracking-wide">
        <PencilRuler className="w-3 h-3" strokeWidth={2} />
        画布
      </span>
      <div className="font-display text-[15px] text-ink mt-2 leading-snug">{label}</div>
      <div className="text-[11px] text-sea mt-2">在右侧查看图形</div>
    </button>
  )
}
