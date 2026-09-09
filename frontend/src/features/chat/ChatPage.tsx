import { useState, useRef, useEffect, useCallback, useLayoutEffect, useMemo } from "react"
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
import type { ChatTipPayload } from "@/features/chat/ChatTipCard"
import {
  appendOnboardingBlock,
  appendCanvasBlock,
  appendPlotBlock,
  appendTextBlock,
  appendTipBlock,
  appendWidgetBlock,
  collectCanvasHistory,
  updateWidgetInPayload,
} from "@/features/chat/chatBlocks"
import type { ChatMessage, Citation } from "@/types"
import { ChatCanvasSidebar, type ChatCanvasItem, type ChatHtmlCanvas } from "@/features/chat/ChatCanvasSidebar"
import type { ChatPlotPayload } from "@/features/chat/ChatFunctionPlot"
import { createSmoothStream } from "@/features/chat/smoothStream"
import { cn } from "@/lib/utils"
import {
  GLITCH_THINK,
  SLASH_COMMANDS,
  isGlitchCmd,
  playTinaGlitch,
} from "@/features/chat/tinaGlitch"
import { parseTinaBursts, type TinaMood } from "@/features/chat/tinaBursts"
import { TinaFacePanel } from "@/features/chat/TinaFacePanel"
import { useTinaCrisis } from "@/context/TinaCrisisContext"
import { remainingCrisisPages } from "@/data/nav"

function latestTinaMood(msgs: ChatMessage[]): TinaMood {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m.role !== "assistant" || !m.content) continue
    const bursts = parseTinaBursts(m.content)
    for (let j = bursts.length - 1; j >= 0; j--) {
      if (bursts[j].mood) return bursts[j].mood as TinaMood
    }
  }
  return "NORMAL"
}

/** 本会话内每发一次 /tina 切换一次脸；与其它会话互不影响 */
function sessionTinaFaceOn(msgs: ChatMessage[]): boolean {
  let on = false
  for (const m of msgs) {
    if (m.role === "user" && m.content.trim() === "/tina") on = !on
  }
  return on
}

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
const LAST_SESSION_KEY = "zhishi_chat_last_session"

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

function readLastSessionId(): string | null {
  try {
    return localStorage.getItem(LAST_SESSION_KEY)
  } catch {
    return null
  }
}

function persistLastSessionId(id: string | null) {
  try {
    if (id) localStorage.setItem(LAST_SESSION_KEY, id)
    else localStorage.removeItem(LAST_SESSION_KEY)
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
  const [canvasSidebarOpen, setCanvasSidebarOpen] = useState(false)
  const [activeCanvas, setActiveCanvas] = useState<ChatCanvasItem | null>(null)

  const canvasHistory = useMemo(() => collectCanvasHistory(messages), [messages])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [sessionReady, setSessionReady] = useState(false)
  const [collectionId, setCollectionId] = useState<string>("")
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const sessionIdRef = useRef<string | null>(null)
  const streamingRef = useRef(false)
  const pendingFollowUpRef = useRef<string | null>(null)
  const [crisisMode, setCrisisMode] = useState(false)
  const crisisRef = useRef(false)
  const glitchRun = useRef(0)
  const [slashIndex, setSlashIndex] = useState(0)
  const [tinaPresence, setTinaPresence] = useState(false)
  const [faceEnterKey, setFaceEnterKey] = useState(0)
  const [faceMood, setFaceMood] = useState<TinaMood>("NORMAL")
  const [faceUsingTool, setFaceUsingTool] = useState(false)
  const tinaPresenceRef = useRef(false)

  useEffect(() => {
    tinaPresenceRef.current = tinaPresence
  }, [tinaPresence])

  useEffect(() => {
    crisisRef.current = crisisMode
  }, [crisisMode])

  useEffect(() => {
    sessionIdRef.current = sessionId
    if (sessionId) persistLastSessionId(sessionId)
  }, [sessionId])

  // 颜文字只跟「当前会话」里的 /tina 次数走，新开对话默认没有
  useEffect(() => {
    const on = sessionTinaFaceOn(messages)
    if (on && !tinaPresenceRef.current) {
      setFaceMood("NORMAL")
      setFaceEnterKey((k) => k + 1)
    }
    setTinaPresence(on)
  }, [messages])

  useEffect(() => {
    if (!tinaPresence) return
    setFaceMood(latestTinaMood(messages))
  }, [messages, tinaPresence])

  // ─── 会话列表 ──────────────────────────────────────

  const loadSessions = async () => {
    try {
      const res = await chatApi.getSessions()
      const items = (res.sessions || res.data || []) as SessionItem[]
      setSessions(items)
      return items
    } catch {
      return [] as SessionItem[]
    }
  }

  useEffect(() => {
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

  // ─── 滚动到底（用户上翻看历史时不要拽回去） ──────────

  const pinToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [])

  const onChatScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = gap < 48
  }, [])

  useLayoutEffect(() => {
    pinToBottom()
  }, [messages, isStreaming, pinToBottom])

  // ─── 打开会话 ──────────────────────────────────────

  const applySession = useCallback(async (id: string) => {
    if (escaping) return
    glitchRun.current += 1
    setSessionId(id)
    persistLastSessionId(id)
    setLoadingHistory(true)
    stickToBottomRef.current = true
    setActiveCanvas(null)
    try {
      const res = await chatApi.getHistory(id)
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
  }, [escaping, active])

  const handleSelectSession = (s: SessionItem) => {
    if (s.id === sessionId) return
    void applySession(s.id)
  }

  // 进入 Tina：URL 指定会话优先，否则回到上次 / 最近一条
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const items = await loadSessions()
      if (cancelled) return
      const urlSession = searchParams.get("session")?.trim()
      const last = readLastSessionId()
      const pick =
        (urlSession && items.find((s) => s.id === urlSession)) ||
        (urlSession ? { id: urlSession, title: "" } as SessionItem : null) ||
        (last && items.find((s) => s.id === last)) ||
        items[0] ||
        null
      if (pick) {
        await applySession(pick.id)
      } else if (!cancelled) {
        setLoadingHistory(false)
      }
      if (!cancelled) setSessionReady(true)
    })()
    return () => {
      cancelled = true
    }
    // 仅首屏恢复；之后靠侧栏切换
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── 新建会话 ──────────────────────────────────────

  const handleNewSession = () => {
    if (escaping) return
    glitchRun.current += 1
    if (!active) setCrisisMode(false)
    setSessionId(null)
    persistLastSessionId(null)
    stickToBottomRef.current = true
    setActiveCanvas(null)
    setMessages([welcomeMessage])
  }

  // ─── 删除会话 ──────────────────────────────────────

  const handleDeleteSession = async (s: SessionItem, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await chatApi.deleteSession(s.id)
      const remaining = sessions.filter((x) => x.id !== s.id)
      setSessions(remaining)
      if (readLastSessionId() === s.id) persistLastSessionId(remaining[0]?.id ?? null)
      if (s.id === sessionId) {
        if (remaining[0]) void applySession(remaining[0].id)
        else handleNewSession()
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

    stickToBottomRef.current = true

    const now = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: trimmed,
      time: now,
    }

    const assistantId = `a-${Date.now()}`
    const liveAssistantIdRef = { current: assistantId }
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
    setFaceUsingTool(false)

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
              persistLastSessionId(sid)
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

    const patchAssistant = (fn: (m: ChatMessage) => ChatMessage) => {
      const id = liveAssistantIdRef.current
      setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)))
    }

    try {
      let messageCitations: Citation[] = []
      let pendingRealId: string | null = null
      const applyStreamPiece = (piece: string, reasoning: boolean) => {
        patchAssistant((m) => {
          if (reasoning) {
            if (crisisRef.current) {
              return { ...m, reasoning_content: GLITCH_THINK, crimson: true }
            }
            return { ...m, reasoning_content: (m.reasoning_content || "") + piece }
          }
          const content = m.content + piece
          const blocks = appendTextBlock(m.payload?.blocks as never, piece)
          return {
            ...m,
            content,
            payload: { ...m.payload, blocks },
            crimson: crisisRef.current || m.crimson,
          }
        })
      }
      const stream = createSmoothStream((piece, kind) => {
        applyStreamPiece(piece, kind === "reasoning")
      })
      try {
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
          if (
            chunk.event === "show_question" ||
            chunk.event === "show_tip" ||
            chunk.event === "show_plot" ||
            chunk.event === "show_canvas" ||
            chunk.event === "onboarding_ui"
          ) {
            stream.flush()
          }
          if (chunk.event === "tool_status") {
            setFaceUsingTool(Boolean(chunk.using))
          }
          if (chunk.event === "show_question" && chunk.question && typeof chunk.question === "object") {
            const q = chunk.question as ChatQuestionWidget["question"]
            const widget = { question: q }
            patchAssistant((m) => {
              const widgets = m.payload?.widgets || []
              if (widgets.some((w) => w.question.question_id === q.question_id)) return m
              const blocks = appendWidgetBlock(m.payload?.blocks as never, widget)
              return {
                ...m,
                payload: { ...m.payload, widgets: [...widgets, widget], blocks },
              }
            })
          }
          if (chunk.event === "show_tip" && chunk.tip && typeof chunk.tip === "object") {
            const tip = chunk.tip as ChatTipPayload
            patchAssistant((m) => {
              const tips = m.payload?.tips || []
              if (tips.some((t) => t.id === tip.id)) return m
              const blocks = appendTipBlock(m.payload?.blocks as never, tip)
              return { ...m, payload: { ...m.payload, tips: [...tips, tip], blocks } }
            })
          }
          if (chunk.event === "show_plot" && chunk.plot && typeof chunk.plot === "object") {
            const plot = chunk.plot as ChatPlotPayload
            if (!Array.isArray(plot.expressions)) return
            setActiveCanvas({ type: "plot", plot })
            setCanvasSidebarOpen(true)
            setCitationSidebarOpen(false)
            patchAssistant((m) => {
              const plots = m.payload?.plots || []
              if (plots.some((p) => p.id === plot.id)) return m
              const blocks = appendPlotBlock(m.payload?.blocks as never, plot)
              return { ...m, payload: { ...m.payload, plots: [...plots, plot], blocks } }
            })
          }
          if (chunk.event === "show_canvas" && chunk.canvas && typeof chunk.canvas === "object") {
            const canvas = chunk.canvas as ChatHtmlCanvas
            if (typeof canvas.html !== "string" || !canvas.html.trim()) return
            setActiveCanvas({ type: "html", canvas })
            setCanvasSidebarOpen(true)
            setCitationSidebarOpen(false)
            patchAssistant((m) => {
              const canvases = m.payload?.canvases || []
              if (canvases.some((c) => c.id === canvas.id)) return m
              const blocks = appendCanvasBlock(m.payload?.blocks as never, canvas)
              return { ...m, payload: { ...m.payload, canvases: [...canvases, canvas], blocks } }
            })
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
              const id = liveAssistantIdRef.current
              return prev.map((m) => {
                if (m.id !== id) return m
                const onboarding = m.payload?.onboarding || []
                const blocks = appendOnboardingBlock(m.payload?.blocks as never, item)
                return { ...m, payload: { ...m.payload, onboarding: [...onboarding, item], blocks } }
              })
            })
          }
          if (chunk.event === "assistant_saved" && chunk.message_id) {
            // 等打字机队列排空后再换真实 id，避免滚动积压时后半段字写丢
            pendingRealId = String(chunk.message_id)
          }
          if (typeof chunk.content === "string") {
            const piece: string = chunk.content
            if (chunk.reasoning_content === true) {
              if (crisisRef.current) applyStreamPiece(piece, true)
              else stream.push(piece, "reasoning")
            } else {
              stream.push(piece, "text")
            }
          }
          if (chunk.session_id && !sessionIdRef.current) {
            const sid = String(chunk.session_id)
            sessionIdRef.current = sid
            persistLastSessionId(sid)
            setSessionId(sid)
            loadSessions()
          }
          if (Array.isArray(chunk.citations) && chunk.citations.length > 0) {
            messageCitations = chunk.citations as Citation[]
            patchAssistant((m) => ({ ...m, citations: messageCitations }))
          }
        },
      })
      } finally {
        stream.flush()
        stream.stop()
        if (pendingRealId) {
          const prevId = liveAssistantIdRef.current
          liveAssistantIdRef.current = pendingRealId
          setMessages((prev) =>
            prev.map((m) => (m.id === prevId ? { ...m, id: pendingRealId! } : m)),
          )
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "请稍后重试"
      patchAssistant((m) => ({ ...m, content: `❌ 发送失败：${msg}` }))
    } finally {
      streamingRef.current = false
      setIsStreaming(false)
      setFaceUsingTool(false)
      const queued = pendingFollowUpRef.current
      pendingFollowUpRef.current = null
      if (queued) void sendText(queued)
    }
  }, [collectionId, escaping, enableCrisis])

  const sendTextRef = useRef(sendText)
  sendTextRef.current = sendText

  useEffect(() => {
    if (!sessionReady) return
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
  }, [searchParams, navigate, escaping, startEscape, sessionReady])

  const handleSend = () => {
    void sendText(input, { clearInput: true })
  }

  // 任务「去验收」等：带 q= 自动发一条，再清掉 URL 避免刷新重发
  const autoQSentRef = useRef<string | null>(null)
  useEffect(() => {
    if (!sessionReady) return
    const q = searchParams.get("q")
    if (!q?.trim()) return
    const key = `${searchParams.get("task") || ""}|${q}`
    if (autoQSentRef.current === key) return

    const taskId = searchParams.get("task")?.trim() || ""
    const text = q.trim()
    let cancelled = false
    const t = window.setTimeout(() => {
      if (cancelled) return
      // 真正发出去再记，避免 Strict Mode 清掉 timeout 后永远不发
      autoQSentRef.current = key
      void sendTextRef.current(text, { clearInput: true })
      navigate(taskId ? `/chat?task=${encodeURIComponent(taskId)}` : "/chat", { replace: true })
    }, 280)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [searchParams, navigate, sessionReady])

  const handleWidgetResolved = (questionId: string, next: ChatQuestionWidget, followUp: string) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (!m.payload?.widgets?.some((w) => w.question.question_id === questionId)) return m
        return {
          ...m,
          payload: updateWidgetInPayload(m.payload, questionId, next),
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
  // 只保留「指令以输入为前缀」：输入 /tina 时同时出现 /tina 与 /tina?
  const slashHits = slashQuery
    ? SLASH_COMMANDS.filter((c) => c.cmd.startsWith(slashQuery))
    : []
  const slashOpen = slashHits.length > 0 && !isStreaming && !loadingHistory

  const streamingAssistant =
    isStreaming && messages.length > 0 && messages[messages.length - 1].role === "assistant"
      ? messages[messages.length - 1]
      : null
  const faceThinking = Boolean(
    streamingAssistant &&
      Boolean(streamingAssistant.reasoning_content) &&
      !streamingAssistant.content &&
      !faceUsingTool,
  )
  const faceSpeaking = Boolean(streamingAssistant && Boolean(streamingAssistant.content) && !faceUsingTool)

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
          {tinaPresence && (
            <div className="shrink-0 px-8 pt-1">
              <div className="max-w-[860px] mx-auto">
                <TinaFacePanel
                  key={faceEnterKey}
                  mood={faceMood}
                  speaking={faceSpeaking}
                  thinking={faceThinking}
                  usingTool={faceUsingTool}
                />
              </div>
            </div>
          )}
          <div
            ref={scrollRef}
            onScroll={onChatScroll}
            className="flex-1 overflow-y-auto scroll-thin px-8 py-6 [overflow-anchor:none]"
          >
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
                  {messages.map((m, i) => (
                    <ChatMessageBlock
                      key={m.id}
                      message={m}
                      onCitationClick={handleCitationClick}
                      onWidgetResolved={handleWidgetResolved}
                      onOnboardingAction={(text) => void sendText(text)}
                      onPlotOpen={(plot) => {
                        setActiveCanvas({ type: "plot", plot })
                        setCanvasSidebarOpen(true)
                        setCitationSidebarOpen(false)
                      }}
                      onCanvasOpen={(canvas) => {
                        setActiveCanvas({ type: "html", canvas })
                        setCanvasSidebarOpen(true)
                        setCitationSidebarOpen(false)
                      }}
                      widgetsDisabled={isStreaming}
                      thinkingActive={
                        isStreaming &&
                        i === messages.length - 1 &&
                        m.role === "assistant" &&
                        Boolean(m.reasoning_content) &&
                        !m.content &&
                        !faceUsingTool
                      }
                      streaming={
                        isStreaming &&
                        i === messages.length - 1 &&
                        m.role === "assistant" &&
                        !m.glitch
                      }
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
                    placeholder={tinaPresence ? "和 Tina 本体说点什么…" : "有什么想问 Tina 的…"}
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

        {/* ────── 右侧可折叠画布；点引用时临时换成引用来源 ────── */}
        {citationSidebarOpen ? (
          <ChatCitationSidebar
            open={citationSidebarOpen}
            onOpenChange={setCitationSidebarOpen}
            citation={activeCitation}
          />
        ) : (
          <ChatCanvasSidebar
            open={canvasSidebarOpen}
            onOpenChange={setCanvasSidebarOpen}
            item={activeCanvas}
            history={canvasHistory}
            onSelectItem={(it) => {
              setActiveCanvas(it)
              setCanvasSidebarOpen(true)
              setCitationSidebarOpen(false)
            }}
            onBack={() => setActiveCanvas(null)}
          />
        )}
      </div>
    </AppShell>
  )
}