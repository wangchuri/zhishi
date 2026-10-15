import { Maximize2, PencilRuler } from "lucide-react"
import { ChatHtmlFrame, type ChatHtmlCanvas } from "@/features/chat/ChatCanvasSidebar"

export function ChatHtmlCard({
  canvas,
  onOpen,
}: {
  canvas: ChatHtmlCanvas
  onOpen?: (canvas: ChatHtmlCanvas) => void
}) {
  const label = canvas.title?.trim() || "交互画布"
  return (
    <>
      {/* 手机：直接在聊天流里小尺寸预览，点开进全屏（不再挤右侧栏） */}
      <button
        type="button"
        onClick={() => onOpen?.(canvas)}
        className="lg:hidden mt-3 block w-full text-left rounded-[14px] border border-line bg-paper overflow-hidden"
      >
        <div className="h-40 overflow-hidden pointer-events-none">
          <ChatHtmlFrame canvas={canvas} zoom={1} />
        </div>
        <div className="flex items-center gap-2 px-3 py-2 border-t border-line-light">
          <PencilRuler className="w-3.5 h-3.5 text-sea shrink-0" strokeWidth={2} />
          <span className="flex-1 truncate text-caption text-ink-soft">{label}</span>
          <span className="shrink-0 inline-flex items-center gap-1 text-caption text-sea">
            <Maximize2 className="w-3 h-3" strokeWidth={2} />
            放大
          </span>
        </div>
      </button>

      {/* 桌面：卡片，点了在右侧打开 */}
      <button
        type="button"
        onClick={() => onOpen?.(canvas)}
        className="hidden lg:block mt-3 w-full max-w-[560px] text-left rounded-[18px] border border-line bg-paper px-4 py-3 shadow-[0_8px_24px_-8px_rgba(20,33,43,0.12)] hover:border-sea/40 transition-colors"
      >
        <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-sea-subtle text-sea text-[10px] font-semibold tracking-wide">
          <PencilRuler className="w-3 h-3" strokeWidth={2} />
          画布
        </span>
        <div className="font-display text-[15px] text-ink mt-2 leading-snug">{label}</div>
        <div className="text-[11px] text-sea mt-2">在右侧查看图形</div>
      </button>
    </>
  )
}
