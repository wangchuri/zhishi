import { useCallback, useEffect, useRef, useState } from "react"
import { Bot, ChevronDown, Loader2, Send, StickyNote } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface AiMessage {
  id: string
  role: "user" | "assistant"
  content: string
}

interface AiFloatingBallProps {
  docName: string
  pageNumber: number | null
  pageContent: string
  onSaveTip?: (content: string, title?: string) => void
  /** 初始位置（悬浮球左上角），缺省时放全屏右下角 */
  initialPos?: { x: number; y: number }
}

export const BALL_SIZE = 56
const PANEL_W = 360

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), Math.max(min, max))
}

function buildMockReply(
  question: string,
  docName: string,
  pageNumber: number | null,
  pageContent: string
): string {
  const pn = pageNumber ?? 1
  const snippet = (pageContent || "").replace(/\s+/g, " ").trim().slice(0, 60)
  const contextLine = snippet ? `\n\n该页开头：「${snippet}…」` : ""
  return `（预览演示，真实回答接入后端后提供）\n\n关于「${question}」，结合《${docName}》第 ${pn} 页的内容，建议从概念定义、示例、易错点三个角度去理解。${contextLine}\n\n你可以选中页面上任意文字「tip 到笔记」，或让我继续围绕这一页展开讲解。`
}

/**
 * AI 伴学悬浮球：可拖拽到任意位置，点击展开为浮动对话窗。
 * 预览阶段对话为本地 mock 流式演示，接入后端后仅替换 send 逻辑。
 */
export function AiFloatingBall({
  docName,
  pageNumber,
  pageContent,
  onSaveTip,
  initialPos,
}: AiFloatingBallProps) {
  const [pos, setPos] = useState(() =>
    initialPos
      ? {
          x: clamp(initialPos.x, 0, Math.max(0, window.innerWidth - BALL_SIZE)),
          y: clamp(initialPos.y, 0, Math.max(0, window.innerHeight - BALL_SIZE)),
        }
      : {
          x: Math.max(0, window.innerWidth - BALL_SIZE - 24),
          y: Math.max(0, window.innerHeight - BALL_SIZE - 96),
        }
  )
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [input, setInput] = useState("")
  const [streamingId, setStreamingId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, streamingId])

  const startDrag = useCallback(
    (e: React.PointerEvent, toggleOnClick: boolean) => {
      if (e.pointerType === "mouse" && e.button !== 0) return
      e.preventDefault()
      const drag = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, moved: false }

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - drag.sx
        const dy = ev.clientY - drag.sy
        if (!drag.moved && Math.hypot(dx, dy) > 5) drag.moved = true
        const w = open ? Math.min(PANEL_W, window.innerWidth - 16) : BALL_SIZE
        setPos({
          x: clamp(drag.ox + dx, 0, window.innerWidth - w),
          y: clamp(drag.oy + dy, 0, window.innerHeight - 40),
        })
      }
      const onUp = () => {
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
        if (toggleOnClick && !drag.moved) setOpen((o) => !o)
      }
      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
    },
    [open, pos]
  )

  const send = () => {
    const text = input.trim()
    if (!text || streamingId) return
    const userMsg: AiMessage = { id: `u-${Date.now()}`, role: "user", content: text }
    const assistantId = `a-${Date.now()}`
    setMessages((m) => [...m, userMsg, { id: assistantId, role: "assistant", content: "" }])
    setInput("")
    setStreamingId(assistantId)

    const answer = buildMockReply(text, docName, pageNumber, pageContent)
    let i = 0
    timerRef.current = setInterval(() => {
      i += 3
      const next = answer.slice(0, i)
      setMessages((m) => m.map((x) => (x.id === assistantId ? { ...x, content: next } : x)))
      if (i >= answer.length) {
        if (timerRef.current) clearInterval(timerRef.current)
        timerRef.current = null
        setStreamingId(null)
      }
    }, 16)
  }

  return (
    <div className="fixed z-40" style={{ left: pos.x, top: pos.y, touchAction: "none" }}>
      {!open ? (
        <button
          type="button"
          onPointerDown={(e) => startDrag(e, true)}
          className="w-14 h-14 rounded-full bg-ink text-paper shadow-lg flex items-center justify-center
                     hover:bg-sea transition-colors cursor-grab active:cursor-grabbing"
          aria-label="AI 伴学"
          style={{ touchAction: "none" }}
        >
          <Bot className="w-6 h-6" strokeWidth={2} />
        </button>
      ) : (
        <div
          onPointerDown={(e) => startDrag(e, false)}
          className="w-[min(360px,calc(100vw-1rem))] max-h-[min(70vh,560px)] flex flex-col
                     rounded-xl border border-line bg-paper shadow-lg overflow-hidden"
          style={{ touchAction: "none" }}
        >
          {/* 头部（可拖拽） */}
          <div className="flex items-center gap-2 px-3 h-12 border-b border-line-light bg-paper shrink-0 cursor-grab active:cursor-grabbing select-none">
            <Bot className="w-5 h-5 text-sea shrink-0" strokeWidth={2} />
            <div className="min-w-0 flex-1">
              <div className="text-small font-semibold text-ink leading-tight">AI 伴学</div>
              <div className="text-caption text-ink-disabled truncate leading-tight">
                《{docName}》第 {pageNumber ?? "—"} 页
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-8 h-8 rounded-md flex items-center justify-center text-ink-disabled hover:text-ink hover:bg-paper-2 transition-colors shrink-0"
              aria-label="收起"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <ChevronDown className="w-4 h-4" strokeWidth={2} />
            </button>
          </div>

          {/* 消息区 */}
          <div ref={scrollRef} className="flex-1 min-h-[180px] max-h-[min(46vh,360px)] overflow-y-auto scroll-thin p-3 space-y-2.5 bg-paper">
            {messages.length === 0 && (
              <div className="text-caption text-ink-disabled text-center py-6 leading-relaxed">
                本页有不懂的地方？直接问我。
                <br />
                <span>（预览版为模拟回复）</span>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-small leading-relaxed whitespace-pre-wrap",
                    m.role === "user"
                      ? "bg-ink text-paper rounded-br-sm"
                      : "bg-paper-2 border border-line-light rounded-bl-sm"
                  )}
                >
                  {m.content}
                  {m.id === streamingId && (
                    <span className="inline-block w-1.5 h-3.5 bg-sea align-text-bottom ml-0.5 animate-pulse" />
                  )}
                </div>
              </div>
            ))}
            {streamingId && (
              <div className="flex justify-end -mt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled
                  className="h-7 px-2 text-caption text-ink-disabled"
                >
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  正在回答…
                </Button>
              </div>
            )}
            {/* 助手消息的 tip 按钮 */}
            {messages.map((m) =>
              m.role === "assistant" && m.content && m.id !== streamingId ? (
                <div key={`tip-${m.id}`} className="flex justify-start -mt-1.5">
                  <button
                    type="button"
                    onClick={() => onSaveTip?.(m.content)}
                    className="inline-flex items-center gap-1 text-caption text-sea hover:underline"
                  >
                    <StickyNote className="w-3 h-3" strokeWidth={2} />
                    tip 到笔记
                  </button>
                </div>
              ) : null
            )}
          </div>

          {/* 输入区 */}
          <div className="border-t border-line-light bg-paper px-3 py-2.5 shrink-0">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
                rows={2}
                placeholder="围绕本页提问…"
                className="flex-1 resize-none rounded-lg border border-line bg-paper-2 px-3 py-2 text-small text-ink placeholder:text-ink-disabled focus:outline-none focus:border-sea focus:ring-1 focus:ring-sea-subtle"
                style={{ minHeight: "44px", maxHeight: "120px" }}
              />
              <button
                type="button"
                onClick={send}
                disabled={!input.trim() || !!streamingId}
                className="w-10 h-10 shrink-0 rounded-full bg-ink text-paper flex items-center justify-center
                           disabled:bg-ink-disabled transition-colors"
                aria-label="发送"
              >
                <Send className="w-4 h-4" strokeWidth={2} />
              </button>
            </div>
            <div className="text-caption text-ink-disabled mt-1.5">
              回答可「tip 到笔记」，自动归档到《{docName}》第 {pageNumber ?? "—"} 页
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
