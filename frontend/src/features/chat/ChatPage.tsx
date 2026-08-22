import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react"
import {
  ArrowUp,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Trash2,
  ChevronRight,
} from "lucide-react"
import { useSearchParams, useNavigate } from "react-router-dom"
import { AppShell } from "@/components/layout/AppShell"
import { ChatCitationSidebar } from "@/components/blocks/ChatCitationSidebar"
import { Button } from "@/components/ui/button"
import { ChatMessage as ChatMessageBlock } from "@/components/blocks/ChatMessage"
import { chatApi, kbApi, normalizeChatHistory } from "@/lib/api"
import type { ChatQuestionWidget } from "@/features/chat/ChatQuestionCard"
import type { ChatMessage, Citation } from "@/types"
import { cn } from "@/lib/utils"
import {
  GLITCH_THINK,
  SLASH_COMMANDS,
  isGlitchCmd,
  playTinaGlitch,
} from "@/features/chat/tinaGlitch"
import { useTinaCrisis } from "@/context/TinaCrisisContext"
import { remainingCrisisPages } from "@/data/nav"

interface SessionItem {
  id: string
  title: string
  kind?: string
  updated_at?: string
  created_at?: string
}

function paintCrisis(msgs: ChatMessage[], crisis: boolean): ChatMessage[] {
  if (!crisis) return msgs
  return msgs.map((m) => (m.role === "assistant" ? { ...m, crimson: true } : m))
}

function mapHistoryItems(items: Array<Record<string, unknown>>): ChatMessage[] {
  const msgs: ChatMessage[] = []
  for (let i = 0; i < items.length; i++) {
    const m = items[i]
    const role = (m.role as ChatMessage["role"]) || "user"
    const content = String(m.content || "")
    if (role === "user" && content === "开始引导") continue
    msgs.push({
      id: String(m.id || `h-${i}`),
      role,
      content,
      time: String(m.time || m.created_at || "—"),
      citations: (m.citations as Citation[]) || undefined,
      reasoning_content: m.reasoning_content ? String(m.reasoning_content) : undefined,
      payload: (m.payload as ChatMessage["payload"]) || undefined,
    })
  }
  return msgs
}

const welcomeMessage: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content: "你好！我是 Tina，你的知识管理助手。\n你可以问我课程知识、让我从题库出一道题，或整理笔记、生成学习路径。",
  time: "刚刚",
}

const HISTORY_SIDEBAR_KEY = "zhishi_chat_history_sidebar"

function readHistorySidebarOpen(): boolean {
  try {
    return localStorage.getItem(HISTORY_SIDEBAR_KEY) === "open"
  } catch {
    return false
  }
}

function persistHistorySidebarOpen(open: boolean) {
  try {
    localStorage.setItem(HISTORY_SIDEBAR_KEY, open ? "open" : "closed")
  } catch {
    /* ignore */
  }
}

export function ChatPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { enableCrisis, deleted, escaping, startEscape, active } = useTinaCrisis()
  const deletedRef = useRef(deleted)
  deletedRef.current = deleted

  const [input, setInput] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage])
  const [isStreaming, setIsStreaming] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(readHistorySidebarOpen)
  const [citationSidebarOpen, setCitationSidebarOpen] = useState(false)
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [collectionId, setCollectionId] = useState<string>("")
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const sessionIdRef = useRef<string | null>(null)
  const streamingRef = useRef(false)
  const pendingFollowUpRef = useRef<string | null>(null)
  const [crisisMode, setCrisisMode] = useState(false)
  const crisisRef = useRef(false)
  const glitchRun = useRef(0)
  const [slashIndex, setSlashIndex] = useState(0)

  useEffect(() => {
    crisisRef.current = crisisMode
  }, [crisisMode])

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  // ─── 会话列表 ──────────────────────────────────────

  const loadSessions = async () => {
    try {
      const res = await chatApi.getSessions()
      const items = res.sessions || res.data || []
      setSessions(items)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    loadSessions()
    kbApi
      .listCollections()
      .then((res) => {
        const cols = res.collections || []
        const defaultCol = cols.find((c: { is_default?: boolean }) => c.is_default) || cols[0]
        if (defaultCol) setCollectionId(defaultCol.id)
      })
      .catch(() => {})
  }, [])

  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [input])

  // ─── 从 Dashboard 跳转过来的自动搜索 / 打开已有会话 ───

  useEffect(() => {
    const sid = searchParams.get("session")
    if (!sid?.trim()) return
    const t = window.setTimeout(() => {
      void handleSelectSession({ id: sid.trim(), title: "" })
    }, 0)
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
    const q = searchParams.get("q")
    if (q?.trim()) {
      const t = setTimeout(() => {
        setInput(q.trim())
        handleSend()
      }, 300)
      return () => clearTimeout(t)
    }
  }, [])

  // ─── 滚动到底 ──────────────────────────────────────

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages])

  // ─── 切换会话 ──────────────────────────────────────

  const handleSelectSession = async (s: SessionItem) => {
    if (escaping) return
    if (s.id === sessionId) return
    glitchRun.current += 1
    setSessionId(s.id)
    setLoadingHistory(true)
    try {
      const res = await chatApi.getHistory(s.id)
      const msgs = mapHistoryItems(normalizeChatHistory(res))
      if (msgs.length === 0) {
        setCrisisMode(active || Boolean(res.crisis))
        setMessages([welcomeMessage])
      } else {
        const crisis = active || Boolean(res.crisis)
        setCrisisMode(crisis)
        setMessages(paintCrisis(msgs, crisis))
      }
    } catch {
      setMessages([welcomeMessage])
    } finally {
      setLoadingHistory(false)
    }
  }

  // ─── 新建会话 ──────────────────────────────────────

  const handleNewSession = () => {
    if (escaping) return
    glitchRun.current += 1
    if (!active) setCrisisMode(false)
    setSessionId(null)
    setMessages([welcomeMessage])
  }

  // ─── 删除会话 ──────────────────────────────────────

  const handleDeleteSession = async (s: SessionItem, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await chatApi.deleteSession(s.id)
      setSessions(prev => prev.filter(x => x.id !== s.id))
      if (s.id === sessionId) {
        handleNewSession()
      }
    } catch {
      // ignore
    }
  }

  // ─── 发送消息 ──────────────────────────────────────

  const sendText = useCallback(async (text: string, opts?: { clearInput?: boolean }) => {
    if (escaping) return
    const trimmed = text.trim()
    if (!trimmed || streamingRef.current) return

    const now = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: trimmed,
      time: now,
    }

    const assistantId = `a-${Date.now()}`
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      time: now,
      crimson: crisisRef.current || isGlitchCmd(trimmed),
      glitch: isGlitchCmd(trimmed),
      reasoning_content: crisisRef.current && !isGlitchCmd(trimmed) ? GLITCH_THINK : undefined,
    }

    streamingRef.current = true
    setMessages((prev) => [...prev, userMsg, assistantMsg])
    if (opts?.clearInput) setInput("")
    setIsStreaming(true)

    if (isGlitchCmd(trimmed)) {
      setCrisisMode(true)
      crisisRef.current = true
      enableCrisis()
      const runId = ++glitchRun.current
      const alive = () => glitchRun.current === runId
      try {
        const persist = chatApi.sendStream({
          content: trimmed,
          session_id: sessionIdRef.current ?? undefined,
          collection_id: collectionId || undefined,
          crisis: true,
          onChunk: (chunk) => {
            if (chunk.session_id && !sessionIdRef.current) {
              const sid = String(chunk.session_id)
              sessionIdRef.current = sid
              setSessionId(sid)
              loadSessions()
            }
          },
        })
        await playTinaGlitch((patch) => {
          if (!alive()) return
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, ...patch, crimson: true, glitch: true } : m)),
          )
        }, alive)
        await persist
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "请稍后重试"
        if (alive()) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content || `❌ 发送失败：${msg}` } : m,
            ),
          )
        }
      } finally {
        streamingRef.current = false
        setIsStreaming(false)
      }
      return
    }

    try {
      let messageCitations: Citation[] = []
      await chatApi.sendStream({
        content: trimmed,
        session_id: sessionIdRef.current ?? undefined,
        collection_id: collectionId || undefined,
        crisis: crisisRef.current,
        remaining_pages: crisisRef.current
          ? remainingCrisisPages(deletedRef.current).filter((name) => {
              const m = trimmed.match(/^(.+)已经被删除了$/)
              return !m || name !== m[1]
            })
          : undefined,
        onChunk: (chunk) => {
          if (chunk.event === "show_question" && chunk.question && typeof chunk.question === "object") {
            const q = chunk.question as ChatQuestionWidget["question"]
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantId) return m
                const widgets = m.payload?.widgets || []
                if (widgets.some((w) => w.question.question_id === q.question_id)) return m
                return { ...m, payload: { ...m.payload, widgets: [...widgets, { question: q }] } }
              })
            )
          }
          if (chunk.event === "onboarding_ui" && chunk.item && typeof chunk.item === "object") {
            const item = chunk.item as { type: string; goal?: string }
            setMessages((prev) => {
              const already = prev.some((msg) =>
                (msg.payload?.onboarding || []).some((x) => {
                  if (item.type === "goal_card") return x.type === "goal_card" && x.goal === item.goal
                  if (item.type === "docs_card") return x.type === "docs_card"
                  if (item.type === "done") return x.type === "done"
                  return false
                })
              )
              if (already) return prev
              return prev.map((m) => {
                if (m.id !== assistantId) return m
                const onboarding = m.payload?.onboarding || []
                return { ...m, payload: { ...m.payload, onboarding: [...onboarding, item] } }
              })
            })
          }
          if (chunk.event === "assistant_saved" && chunk.message_id) {
            const realId = String(chunk.message_id)
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, id: realId } : m))
            )
          }
          if (typeof chunk.content === "string") {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantId) return m
                if (chunk.reasoning_content === true) {
                  if (crisisRef.current) {
                    return { ...m, reasoning_content: GLITCH_THINK, crimson: true }
                  }
                  return { ...m, reasoning_content: (m.reasoning_content || "") + chunk.content }
                }
                return {
                  ...m,
                  content: m.content + chunk.content,
                  crimson: crisisRef.current || m.crimson,
                }
              })
            )
          }
          if (chunk.session_id && !sessionIdRef.current) {
            const sid = String(chunk.session_id)
            sessionIdRef.current = sid
            setSessionId(sid)
            loadSessions()
          }
          if (Array.isArray(chunk.citations) && chunk.citations.length > 0) {
            messageCitations = chunk.citations as Citation[]
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, citations: messageCitations } : m
              )
            )
          }
        },
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "请稍后重试"
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: `❌ 发送失败：${msg}` } : m
        )
      )
    } finally {
      streamingRef.current = false
      setIsStreaming(false)
      const queued = pendingFollowUpRef.current
      pendingFollowUpRef.current = null
      if (queued) void sendText(queued)
    }
  }, [collectionId, escaping, enableCrisis])

  const sendTextRef = useRef(sendText)
  sendTextRef.current = sendText

  useEffect(() => {
    const gone = searchParams.get("gone")
    if (!gone?.trim() || escaping) return
    const label = gone.trim()
    const leftover = remainingCrisisPages(deletedRef.current).filter((name) => name !== label)
    const t = window.setTimeout(() => {
      if (leftover.length === 0) {
        startEscape()
        navigate("/chat", { replace: true })
        return
      }
      const text = `${label}已经被删除了`
      if (streamingRef.current) {
        pendingFollowUpRef.current = text
      } else {
        void sendTextRef.current(text)
      }
      navigate("/chat", { replace: true })
    }, 180)
    return () => window.clearTimeout(t)
  }, [searchParams, navigate, escaping, startEscape])

  const handleSend = () => {
    void sendText(input, { clearInput: true })
  }

  const handleWidgetResolved = (questionId: string, next: ChatQuestionWidget, followUp: string) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (!m.payload?.widgets?.some((w) => w.question.question_id === questionId)) return m
        return {
          ...m,
          payload: {
            ...m.payload,
            widgets: m.payload.widgets.map((w) =>
              w.question.question_id === questionId ? next : w
            ),
          },
        }
      })
    )
    if (streamingRef.current) {
      pendingFollowUpRef.current = followUp
    } else {
      void sendText(followUp)
    }
  }

  const handleCitationClick = (citation: Citation) => {
    setActiveCitation(citation)
    setCitationSidebarOpen(true)
  }

  const toggleHistorySidebar = () => {
    setSidebarOpen((prev) => {
      const next = !prev
      persistHistorySidebarOpen(next)
      return next
    })
  }

  const slashQuery = input.startsWith("/") ? input.trim() : ""
  const slashHits = slashQuery
    ? SLASH_COMMANDS.filter((c) => c.cmd.startsWith(slashQuery) || slashQuery.startsWith(c.cmd))
    : []
  const slashOpen = slashHits.length > 0 && !isStreaming && !loadingHistory

  // ─── 格式化时间 ────────────────────────────────────

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "—"
    try {
      const d = new Date(dateStr)
      const now = new Date()
      const diff = now.getTime() - d.getTime()
      if (diff < 86400000) {
        return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
      }
      if (diff < 604800000) {
        const days = ["日", "一", "二", "三", "四", "五", "六"]
        return `周${days[d.getDay()]}`
      }
      return `${d.getMonth() + 1}/${d.getDate()}`
    } catch {
      return "—"
    }
  }

  return (
    <AppShell maxWidth={null} noPadding>
      <div className="flex h-full">
        {/* ────── 左侧可折叠历史侧栏 ────── */}
        <div className={cn(
          "shrink-0 border-r border-line-soft bg-surface/60 flex flex-col transition-all duration-200",
          sidebarOpen ? "w-[260px]" : "w-[44px]",
        )}>
          <div className={cn("flex items-center gap-2 px-3 py-3 border-b border-line-soft", !sidebarOpen && "justify-center px-0")}>
            {sidebarOpen && (
              <>
                <span className="text-card-title font-semibold text-ink-primary flex-1">历史会话</span>
                <button
                  onClick={handleNewSession}
                  className="w-8 h-8 rounded-md flex items-center justify-center text-ink-tertiary hover:text-primary hover:bg-primary-soft transition-colors"
                  title="新建会话"
                >
                  <Plus className="w-4 h-4" strokeWidth={2} />
                </button>
              </>
            )}
            <button
              onClick={toggleHistorySidebar}
              className="w-8 h-8 rounded-md flex items-center justify-center text-ink-tertiary hover:text-ink-primary hover:bg-surface-soft transition-colors shrink-0"
              title={sidebarOpen ? "折叠历史" : "展开历史"}
            >
              {sidebarOpen
                ? <PanelLeftClose className="w-4 h-4" strokeWidth={2} />
                : <PanelLeftOpen className="w-4 h-4" strokeWidth={2} />
              }
            </button>
          </div>

          {sidebarOpen && (
            <div className="flex-1 overflow-y-auto scroll-thin px-2 py-2">
              {sessions.length === 0 ? (
                <div className="text-caption text-ink-tertiary text-center py-8">暂无历史会话</div>
              ) : (
                sessions.map(s => (
                  <div
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectSession(s)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSelectSession(s) }}
                    className={cn(
                      "w-full text-left px-3 py-2.5 rounded-[4px] flex items-center gap-2 group transition-colors mb-0.5 cursor-pointer",
                      s.id === sessionId
                        ? "bg-sea-subtle text-sea"
                        : "hover:bg-paper-2 text-ink-soft",
                    )}
                  >
                    <span className="flex-1 truncate text-small">
                      {s.kind === "onboarding" ? "引导 · " : ""}
                      {s.title || "新对话"}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-caption text-ink-tertiary">
                        {formatDate(s.updated_at || s.created_at)}
                      </span>
                      <button
                        onClick={(e) => handleDeleteSession(s, e)}
                        className="w-8 h-8 rounded flex items-center justify-center opacity-100 can-hover:opacity-0 can-hover:group-hover:opacity-100 hover:bg-danger-soft hover:text-danger transition-all"
                        title="删除会话"
                      >
                        <Trash2 className="w-3 h-3" strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {!sidebarOpen && (
            <div className="flex-1 flex items-center justify-center">
              <button
                onClick={() => {
                  setSidebarOpen(true)
                  persistHistorySidebarOpen(true)
                }}
                className="flex flex-col items-center gap-1.5 text-ink-tertiary hover:text-primary transition-colors py-8"
              >
                <ChevronRight className="w-4 h-4" strokeWidth={2} />
                <span className="text-caption font-medium [writing-mode:vertical-rl] tracking-wider">历史</span>
              </button>
            </div>
          )}
        </div>

        {/* ────── 对话主区域 ────── */}
        <div className="flex-1 flex flex-col min-w-0">
          <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-thin px-8 py-6">
            <div className="max-w-[860px] mx-auto space-y-4">
              {loadingHistory ? (
                <div className="flex items-center justify-center py-12">
                  <div className="flex items-center gap-2 text-ink-disabled">
                    <div className="w-5 h-5 border-2 border-sea/30 border-t-sea rounded-full animate-spin" />
                    <span className="text-body">加载历史消息...</span>
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((m) => (
                    <ChatMessageBlock
                      key={m.id}
                      message={m}
                      onCitationClick={handleCitationClick}
                      onWidgetResolved={handleWidgetResolved}
                      onOnboardingAction={(text) => void sendText(text)}
                      widgetsDisabled={isStreaming}
                    />
                  ))}
                  {isStreaming &&
                    messages.length > 0 &&
                    messages[messages.length - 1].role === "assistant" &&
                    !messages[messages.length - 1].content &&
                    !messages[messages.length - 1].reasoning_content &&
                    !(messages[messages.length - 1].payload?.widgets || []).length && (
                    <div className="flex items-center gap-1.5 pt-1 animate-msg-in">
                      <span className="w-1.5 h-1.5 rounded-full bg-sea animate-pulse" />
                      <span className="w-1.5 h-1.5 rounded-full bg-sea animate-pulse [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-sea animate-pulse [animation-delay:300ms]" />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="px-8 pt-3 pb-4" style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
            <div className="max-w-[860px] mx-auto">
              <div className="relative rounded-[24px] border border-line bg-surface shadow-xs focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10 transition-all">
                {slashOpen && (
                  <div className="absolute left-0 right-0 bottom-full mb-2 rounded-[4px] border border-line bg-paper shadow-sm overflow-hidden z-20">
                    <div className="px-3 py-1.5 text-caption text-ink-disabled border-b border-line-light">
                      指令
                    </div>
                    {slashHits.map((item, i) => (
                      <button
                        key={item.cmd}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          setInput(item.cmd)
                          setSlashIndex(0)
                        }}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-2.5 text-left text-small",
                          i === slashIndex ? "bg-danger-soft text-danger" : "text-ink-soft hover:bg-paper-2",
                        )}
                      >
                        <span className="font-mono">{item.cmd}</span>
                        <span className="text-caption text-ink-disabled">{item.hint}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2 pl-4 pr-2 py-2">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => {
                      setInput(e.target.value)
                      setSlashIndex(0)
                    }}
                    onKeyDown={(e) => {
                      if (slashOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                        e.preventDefault()
                        setSlashIndex((n) => {
                          const next = e.key === "ArrowDown" ? n + 1 : n - 1
                          return (next + slashHits.length) % slashHits.length
                        })
                        return
                      }
                      if (slashOpen && e.key === "Tab") {
                        e.preventDefault()
                        setInput(slashHits[slashIndex]?.cmd || slashHits[0].cmd)
                        return
                      }
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        if (slashOpen && !isGlitchCmd(input) && input.trim() !== slashHits[slashIndex]?.cmd) {
                          setInput(slashHits[slashIndex]?.cmd || slashHits[0].cmd)
                          return
                        }
                        handleSend()
                      }
                    }}
                    placeholder="有什么想问 Tina 的…"
                    rows={1}
                    className="flex-1 resize-none bg-transparent py-2 text-body text-ink-primary placeholder:text-ink-tertiary focus:outline-none leading-relaxed"
                    style={{ maxHeight: "200px", overflowY: "auto" }}
                    disabled={isStreaming || loadingHistory}
                  />
                  <Button
                    variant={input.trim() && !isStreaming ? "primary" : "secondary"}
                    size="icon"
                    onClick={handleSend}
                    disabled={!input.trim() || isStreaming || loadingHistory}
                    aria-label="发送"
                    className="shrink-0 rounded-full mb-0.5"
                  >
                    <ArrowUp className="w-[18px] h-[18px]" strokeWidth={2} />
                  </Button>
                </div>
              </div>
              <div className="text-small text-ink-tertiary mt-2 text-center">
                Enter 发送 · Shift + Enter 换行 · Tina 可能会出错，请核实重要信息
              </div>
            </div>
          </div>
        </div>

        {/* ────── 右侧可折叠引用侧栏 ────── */}
        <ChatCitationSidebar
          open={citationSidebarOpen}
          onOpenChange={setCitationSidebarOpen}
          citation={activeCitation}
        />
      </div>
    </AppShell>
  )
}