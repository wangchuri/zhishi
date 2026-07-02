import { useEffect, useState } from "react"
import { Loader2, Send, Sparkles, X } from "lucide-react"
import { tutorApi } from "@/lib/api"
import type { TutorMessage, TutorSession } from "@/types"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface TutorPanelProps {
  questionId: string
  quizSessionId?: string
  onClose?: () => void
  className?: string
}

export function TutorPanel({
  questionId,
  quizSessionId,
  onClose,
  className,
}: TutorPanelProps) {
  const [session, setSession] = useState<TutorSession | null>(null)
  const [messages, setMessages] = useState<TutorMessage[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    tutorApi
      .createSession({ question_id: questionId, quiz_session_id: quizSessionId })
      .then((res) => {
        if (cancelled) return
        const s = res as unknown as TutorSession
        setSession(s)
        setMessages(s.messages || [])
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || "无法创建辅导会话")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [questionId, quizSessionId])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || !session || sending) return

    const userMsg: TutorMessage = { role: "user", content: text, created_at: new Date().toISOString() }
    setMessages((prev) => [...prev, userMsg])
    setInput("")
    setSending(true)

    const assistantMsg: TutorMessage = { role: "assistant", content: "", created_at: new Date().toISOString() }
    setMessages((prev) => [...prev, assistantMsg])

    try {
      await tutorApi.sendMessageStream(session.id, text, (chunk) => {
        if (typeof chunk.content === "string") {
          setMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last?.role === "assistant") {
              next[next.length - 1] = { ...last, content: last.content + chunk.content }
            }
            return next
          })
        }
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "发送失败"
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last?.role === "assistant" && !last.content) {
          next[next.length - 1] = { ...last, content: `❌ ${msg}` }
        }
        return next
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={cn("flex flex-col h-full bg-surface border border-line-soft rounded-lg", className)}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-line-soft">
        <div className="w-8 h-8 rounded-full bg-gradient-primary flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-white" strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-card-title font-semibold text-ink-primary">苏格拉底辅导</div>
          <div className="text-caption text-ink-tertiary truncate">
            {session?.question_stem || "基于题目与原文引导思考"}
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-md flex items-center justify-center text-ink-tertiary hover:text-ink-primary hover:bg-surface-soft"
          >
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        )}
      </div>

      {session?.segment_context?.snippet && (
        <div className="px-4 py-2.5 bg-surface-soft border-b border-line-soft text-caption text-ink-secondary line-clamp-3">
          📖 {session.segment_context.title}: {session.segment_context.snippet}
        </div>
      )}

      <div className="flex-1 overflow-y-auto scroll-thin p-4 space-y-3 min-h-[200px]">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-ink-tertiary gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-body">准备辅导中...</span>
          </div>
        ) : error ? (
          <div className="text-body text-danger">{error}</div>
        ) : messages.length === 0 ? (
          <div className="text-small text-ink-tertiary text-center py-6">
            说说哪里不懂，Agent 会结合原文引导你思考
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                "text-body leading-relaxed",
                m.role === "user"
                  ? "flex justify-end"
                  : "flex gap-2 mr-2"
              )}
            >
              {m.role === "assistant" && (
                <div className="w-7 h-7 rounded-full bg-gradient-primary flex items-center justify-center shrink-0 mt-0.5">
                  <Sparkles className="w-3.5 h-3.5 text-white" strokeWidth={2} />
                </div>
              )}
              <div
                className={cn(
                  "rounded-lg px-3 py-2 max-w-[85%]",
                  m.role === "user"
                    ? "bg-primary text-white rounded-tr-sm"
                    : "bg-surface border border-line-soft text-ink-primary rounded-tl-sm"
                )}
              >
                {m.content || (sending && i === messages.length - 1 ? "..." : "")}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-3 border-t border-line-soft">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="输入你的疑问..."
            rows={2}
            disabled={loading || !!error || sending}
            className="flex-1 resize-none rounded-md border border-line bg-surface px-3 py-2 text-body text-ink-primary placeholder:text-ink-tertiary focus:outline-none focus:border-primary/50"
          />
          <Button
            variant="primary"
            size="icon"
            onClick={handleSend}
            disabled={!input.trim() || loading || !!error || sending}
            aria-label="发送"
          >
            <Send className="w-4 h-4" strokeWidth={2} />
          </Button>
        </div>
      </div>
    </div>
  )
}
