import { useEffect, useRef, useState } from "react"
import { Bot, FileText, Loader2, Send, StickyNote, X } from "lucide-react"
import { MarkdownWithMath } from "@/components/blocks/MarkdownWithMath"
import { companionApi, documentImageBase, notesApi, type CompanionMessage, type NoteItem } from "@/lib/api"
import { cn } from "@/lib/utils"

export type AssistTab = "ai" | "tip"

interface ReadingAssistSidebarProps {
  docId: string
  docName: string
  pageNumber: number | null
  pageContent: string
  open: boolean
  tab: AssistTab
  onOpenChange: (open: boolean) => void
  onTabChange: (tab: AssistTab) => void
  onSaveTip?: (content: string, title?: string) => void
  onJumpToPage?: (page: number) => void
  tipRefreshKey?: number
}

const SIDEBAR_WIDTH = 380

export function ReadingAssistSidebar({
  docId,
  docName,
  pageNumber,
  pageContent,
  open,
  tab,
  onOpenChange,
  onTabChange,
  onSaveTip,
  onJumpToPage,
  tipRefreshKey = 0,
}: ReadingAssistSidebarProps) {
  const [messages, setMessages] = useState<CompanionMessage[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [streamingId, setStreamingId] = useState<string | null>(null)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [tips, setTips] = useState<NoteItem[]>([])
  const [tipsLoading, setTipsLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadIdRef = useRef<string>("")

  useEffect(() => {
    if (!open || tab !== "ai" || historyLoaded) return
    let cancelled = false
    const loadId = docId
    loadIdRef.current = loadId
    setLoading(true)
    companionApi
      .getHistory(docId)
      .then((res) => {
        if (cancelled || loadIdRef.current !== loadId) return
        setMessages(res.messages || [])
        setHistoryLoaded(true)
      })
      .catch(() => {
        if (!cancelled) {
          setMessages([])
          setHistoryLoaded(true)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, tab, docId, historyLoaded])

  useEffect(() => {
    setMessages([])
    setHistoryLoaded(false)
    setStreamingId(null)
  }, [docId])

  useEffect(() => {
    if (!open || tab !== "tip") return
    let cancelled = false
    void (async () => {
      setTipsLoading(true)
      try {
        const res = await notesApi.listTips(docId)
        if (!cancelled) setTips(res.notes || [])
      } catch {
        if (!cancelled) setTips([])
      } finally {
        if (!cancelled) setTipsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [docId, open, tab, tipRefreshKey])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, streamingId])

  const send = async () => {
    const text = input.trim()
    if (!text || streamingId || !open) return

    const userMsg: CompanionMessage = { role: "user", content: text, created_at: new Date().toISOString() }
    setMessages((prev) => [...prev, userMsg, { role: "assistant", content: "", created_at: new Date().toISOString() }])
    setInput("")
    setStreamingId(`a-${Date.now()}`)

    try {
      await companionApi.sendStream({
        document_id: docId,
        content: text,
        page_number: pageNumber,
        page_content: pageContent,
        onChunk: (chunk) => {
          if (typeof chunk.content === "string") {
            setMessages((prev) =>
              prev.map((m) =>
                m.role === "assistant" && prev.indexOf(m) === prev.length - 1
                  ? { ...m, content: m.content + chunk.content }
                  : m
              )
            )
          }
          if (Array.isArray(chunk.citations) && chunk.citations.length > 0) {
            setMessages((prev) =>
              prev.map((m) =>
                m.role === "assistant" && prev.indexOf(m) === prev.length - 1
                  ? { ...m, citations: chunk.citations as CompanionMessage["citations"] }
                  : m
              )
            )
          }
        },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : "请稍后重试"
      setMessages((prev) =>
        prev.map((m) =>
          m.role === "assistant" && prev.indexOf(m) === prev.length - 1
            ? { ...m, content: `❌ 发送失败：${msg}` }
            : m
        )
      )
    } finally {
      setStreamingId(null)
    }
  }

  const parsePage = (note: NoteItem): number | null => {
    if (typeof note.page_number === "number") return note.page_number
    const m = /第\s*(\d+)\s*页/.exec(note.title || "")
    return m ? Number(m[1]) : null
  }

  return (
    <aside
      aria-hidden={!open}
      className={cn(
        "shrink-0 bg-paper flex flex-col overflow-hidden transition-[width] duration-300",
        open ? "border-l border-line" : "border-l-0"
      )}
      style={{ width: open ? `min(${SIDEBAR_WIDTH}px, 65vw)` : 0 }}
      role="dialog"
      aria-label="阅读助手"
    >
      <div className="flex items-center gap-1 px-2 h-12 border-b border-line shrink-0">
        <div className="flex flex-1 min-w-0 rounded-lg bg-paper-2 p-0.5">
          <button
            type="button"
            onClick={() => onTabChange("ai")}
            className={cn(
              "flex-1 h-8 rounded-md text-caption font-medium inline-flex items-center justify-center gap-1 transition-colors",
              tab === "ai" ? "bg-paper text-ink shadow-xs" : "text-ink-soft hover:text-ink"
            )}
          >
            <Bot className="w-3.5 h-3.5" strokeWidth={2} />
            AI
          </button>
          <button
            type="button"
            onClick={() => onTabChange("tip")}
            className={cn(
              "flex-1 h-8 rounded-md text-caption font-medium inline-flex items-center justify-center gap-1 transition-colors",
              tab === "tip" ? "bg-paper text-ink shadow-xs" : "text-ink-soft hover:text-ink"
            )}
          >
            <FileText className="w-3.5 h-3.5" strokeWidth={2} />
            Tip
          </button>
        </div>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="w-8 h-8 rounded-md flex items-center justify-center text-ink-disabled hover:text-ink hover:bg-paper-2 transition-colors shrink-0"
          aria-label="关闭侧栏"
        >
          <X className="w-4 h-4" strokeWidth={2} />
        </button>
      </div>

      {tab === "ai" ? (
        <>
          <div className="px-3 py-1.5 border-b border-line-light shrink-0">
            <div className="text-caption text-ink-disabled truncate">
              《{docName}》{pageNumber != null ? `· 第 ${pageNumber} 页` : ""} · 对话按书保存
            </div>
          </div>
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto scroll-thin p-3 space-y-2.5 bg-paper">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-caption text-ink-disabled gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> 加载对话记录…
              </div>
            ) : messages.length === 0 ? (
              <div className="text-caption text-ink-disabled text-center py-8 leading-relaxed">
                本页有不懂的地方？直接问我。
                <br />
                对话记录会按这本书自动保存。
              </div>
            ) : (
              messages.map((m, i) => {
                if (m.role !== "assistant") {
                  return (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[85%] rounded-lg px-3 py-2 text-small leading-relaxed whitespace-pre-wrap bg-ink text-paper rounded-br-sm">
                        {m.content}
                      </div>
                    </div>
                  )
                }
                const isStreaming = streamingId != null && i === messages.length - 1
                return (
                  <div key={i} className="space-y-1">
                    <div className="flex justify-start">
                      <div
                        className={cn(
                          "max-w-[85%] rounded-lg px-3 py-2 text-small leading-relaxed bg-paper-2 border border-line-light rounded-bl-sm",
                          m.content === "" && isStreaming && "min-h-[2rem]"
                        )}
                      >
                        {m.content ? (
                          <div className="text-body text-ink leading-relaxed">
                            <MarkdownWithMath className="prose prose-sm max-w-none prose-p:my-1 prose-p:text-inherit prose-headings:text-inherit prose-strong:text-inherit">
                              {m.content}
                            </MarkdownWithMath>
                          </div>
                        ) : isStreaming ? (
                          ""
                        ) : (
                          "（暂无回复）"
                        )}
                        {isStreaming && (
                          <span className="inline-block w-1.5 h-3.5 bg-sea align-text-bottom ml-0.5 animate-pulse" />
                        )}
                      </div>
                    </div>
                    {m.content && !isStreaming && onSaveTip && (
                      <div className="flex justify-start pl-1">
                        <button
                          type="button"
                          onClick={() =>
                            onSaveTip(m.content, `《${docName}》AI · 第 ${pageNumber ?? "—"} 页`)
                          }
                          className="inline-flex items-center gap-1 text-caption text-sea hover:underline"
                        >
                          <StickyNote className="w-3 h-3" strokeWidth={2} />
                          tip 到笔记
                        </button>
                      </div>
                    )}
                  </div>
                )
              })
            )}
            {streamingId && (
              <div className="flex justify-end">
                <span className="inline-flex items-center gap-1 text-caption text-ink-disabled">
                  <Loader2 className="w-3 h-3 animate-spin" /> 正在回答…
                </span>
              </div>
            )}
          </div>
          <div className="border-t border-line bg-paper px-3 py-2.5 shrink-0">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
                rows={2}
                placeholder="围绕本页提问…"
                className="flex-1 resize-none rounded-lg border border-line bg-paper-2 px-3 py-2 text-small text-ink placeholder:text-ink-disabled focus:outline-none focus:border-sea focus:ring-1 focus:ring-sea-subtle"
                style={{ minHeight: "44px", maxHeight: "120px" }}
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={!input.trim() || !!streamingId}
                className="w-10 h-10 shrink-0 rounded-full bg-ink text-paper flex items-center justify-center disabled:bg-ink-disabled transition-colors"
                aria-label="发送"
              >
                <Send className="w-4 h-4" strokeWidth={2} />
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin p-3 space-y-2.5">
          {tipsLoading ? (
            <div className="flex items-center justify-center py-8 text-caption text-ink-disabled gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> 加载 tip…
            </div>
          ) : tips.length === 0 ? (
            <div className="text-caption text-ink-disabled text-center py-10 leading-relaxed">
              还没有 tip。
              <br />
              在正文划选文字、点选插图，或把 AI 回答 tip 进来。
            </div>
          ) : (
            tips.map((tip) => {
              const page = parsePage(tip)
              const tipDocId = tip.document_id || docId
              return (
                <button
                  key={tip.id}
                  type="button"
                  onClick={() => page != null && onJumpToPage?.(page)}
                  className={cn(
                    "w-full text-left rounded-lg border border-line-light bg-paper-2 px-3 py-2.5 space-y-1.5 transition-colors",
                    page != null ? "hover:border-sea/40 hover:bg-paper" : "cursor-default"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-caption font-medium text-sea shrink-0">
                      第 {page ?? "—"} 页
                    </span>
                    <span className="text-small font-medium text-ink truncate flex-1">{tip.title}</span>
                  </div>
                  <div
                    className="text-caption text-ink-soft leading-relaxed max-h-28 overflow-hidden [&_img]:max-h-16 [&_img]:rounded-md [&_img]:my-1 [&_p]:my-0.5"
                    data-no-tip
                  >
                    <MarkdownWithMath
                      proseClass="prose prose-sm max-w-none text-ink-soft"
                      imageBaseUrl={tipDocId ? documentImageBase(tipDocId) : undefined}
                    >
                      {tip.content_md || ""}
                    </MarkdownWithMath>
                  </div>
                </button>
              )
            })
          )}
        </div>
      )}
    </aside>
  )
}
