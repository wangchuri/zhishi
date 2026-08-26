import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { ArrowRight, Loader2, UploadCloud } from "lucide-react"
import { AppLogo } from "@/components/layout/AppLogo"
import { useAuth } from "@/context/AuthContext"
import { kbApi, chatApi, onboardingApi, profileApi, type OnboardingUiItem } from "@/lib/api"
import { notifyCompletedTasks } from "@/lib/taskNotify"
import { cn } from "@/lib/utils"

type RailId = "meet" | "goal" | "docs" | "done"
type RailMark = "" | "on" | "done" | "skip"

type Msg =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "tina"; text: string; streaming?: boolean }
  | { id: string; kind: "goal-card"; goal: string; locked?: boolean }
  | { id: string; kind: "docs-card"; locked?: boolean; fileName?: string }
  | { id: string; kind: "leave" }
  | { id: string; kind: "home-link" }

const STEPS: { id: RailId; label: string; desc: string }[] = [
  { id: "meet", label: "认识你", desc: "聊起来就会记住" },
  { id: "goal", label: "确认学习目标", desc: "收成一句能盯着的目标" },
  { id: "docs", label: "添加资料", desc: "有讲义再收，没有可跳过" },
  { id: "done", label: "开始使用", desc: "回首页，之后在 Tina 栏找我" },
]

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function goalConfirmed(messages: Msg[]) {
  return messages.some(
    (m) => m.kind === "user" && /确认这个目标|确认，就是这个/.test(m.text)
  )
}

function deriveRail(messages: Msg[], completed: boolean): Record<RailId, RailMark> {
  const confirmed = goalConfirmed(messages)
  const goalShown = messages.some((m) => m.kind === "goal-card")
  const docsShown = messages.some((m) => m.kind === "docs-card")
  const docsHandled = messages.some(
    (m) =>
      (m.kind === "docs-card" && (m.locked || m.fileName)) ||
      (m.kind === "user" && /先跳过|已经上传了资料/.test(m.text))
  )
  const skipped = messages.some((m) => m.kind === "user" && /先跳过/.test(m.text))
  const left = messages.some((m) => m.kind === "leave" || m.kind === "home-link")
  const hasUser = messages.some((m) => m.kind === "user")

  if (completed || left) {
    return {
      meet: "done",
      goal: "done",
      docs: skipped ? "skip" : "done",
      done: "done",
    }
  }

  const rail: Record<RailId, RailMark> = { meet: "", goal: "", docs: "", done: "" }
  if (goalShown || confirmed || hasUser) rail.meet = "done"
  if (confirmed) {
    rail.goal = "done"
    rail.docs = docsHandled ? (skipped ? "skip" : "done") : "on"
    if (docsHandled) rail.done = "on"
  } else if (goalShown) {
    rail.goal = "on"
  } else if (hasUser) {
    rail.meet = "on"
  }
  if (docsShown && confirmed && !docsHandled) rail.docs = "on"
  return rail
}

function historyToMessages(raw: Array<Record<string, unknown>>): Msg[] {
  const out: Msg[] = []
  for (const row of raw) {
    const role = String(row.role || "")
    const content = String(row.content || "")
    const id = String(row.id || uid())
    if (role === "user") {
      if (content === "开始引导") continue
      out.push({ id, kind: "user", text: content })
      continue
    }
    if (role === "assistant" && content) {
      out.push({ id, kind: "tina", text: content })
    }
    const payload = row.payload as { onboarding?: OnboardingUiItem[] } | undefined
    const items = payload?.onboarding || []
    const hasGoal = items.some((item) => item.type === "goal_card")
    for (const item of items) {
      if (item.type === "goal_card" && item.goal) {
        if (out.some((m) => m.kind === "goal-card" && m.goal === item.goal)) continue
        out.push({ id: uid(), kind: "goal-card", goal: item.goal, locked: true })
      }
      if (item.type === "docs_card" && !hasGoal) {
        if (out.some((m) => m.kind === "docs-card")) continue
        out.push({ id: uid(), kind: "docs-card", locked: true })
      }
      if (item.type === "done") {
        if (out.some((m) => m.kind === "home-link" || m.kind === "leave")) continue
        out.push({ id: uid(), kind: "home-link" })
      }
    }
  }
  const confirmed = goalConfirmed(out)
  const skipped = out.some((m) => m.kind === "user" && /先跳过/.test(m.text))
  const uploaded = out.some((m) => m.kind === "user" && /已经上传了资料/.test(m.text))
  if (confirmed && !out.some((m) => m.kind === "docs-card")) {
    out.push({ id: uid(), kind: "docs-card", locked: skipped || uploaded })
  }
  if ((skipped || uploaded) && !out.some((m) => m.kind === "home-link" || m.kind === "leave")) {
    out.push({ id: uid(), kind: "home-link" })
  }
  const lastGoal = [...out].reverse().find((m) => m.kind === "goal-card")
  const lastDocs = [...out].reverse().find((m) => m.kind === "docs-card")
  return out.map((m) => {
    if (m.kind === "goal-card" && lastGoal && m.id === lastGoal.id) {
      return { ...m, locked: confirmed }
    }
    if (m.kind === "docs-card") {
      if (skipped || uploaded) return { ...m, locked: true }
      if (lastDocs && m.id === lastDocs.id) return { ...m, locked: false }
    }
    return m
  })
}

export function OnboardingPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { setNickname } = useAuth()
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [goalSaved, setGoalSaved] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [rail, setRail] = useState<Record<RailId, RailMark>>({
    meet: "",
    goal: "",
    docs: "",
    done: "",
  })

  const sessionIdRef = useRef<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const startedRef = useRef(false)

  const goHome = () => navigate("/", { replace: true })

  const finishDocsStep = useCallback((fileName?: string) => {
    setCompleted(true)
    setMessages((prev) => {
      const next = prev.map((m) =>
        m.kind === "docs-card" ? { ...m, locked: true, fileName: fileName || m.fileName } : m
      )
      if (next.some((m) => m.kind === "home-link" || m.kind === "leave")) return next
      return [...next, { id: uid(), kind: "home-link" }]
    })
    void profileApi.put({ onboarding_status: "completed" })
  }, [])

  const applyUi = useCallback(
    (item: OnboardingUiItem, assistantId: string) => {
      if (item.nickname) setNickname(item.nickname)
      if (item.type === "goal_card" && item.goal) {
        setGoalSaved(true)
        setMessages((prev) => {
          if (prev.some((m) => m.kind === "goal-card" && m.goal === item.goal)) return prev
          const locked = prev.map((m) => (m.kind === "goal-card" ? { ...m, locked: true } : m))
          return [...locked, { id: uid(), kind: "goal-card", goal: item.goal || "" }]
        })
      }
      if (item.type === "docs_card") {
        setMessages((prev) => {
          if (prev.some((m) => m.kind === "docs-card")) return prev
          const waitingGoal = prev.some((m) => m.kind === "goal-card" && !m.locked)
          if (waitingGoal) return prev
          return [...prev, { id: uid(), kind: "docs-card" }]
        })
      }
      if (item.type === "done") {
        setCompleted(true)
        setMessages((prev) => {
          if (prev.some((m) => m.kind === "home-link" || m.kind === "leave")) return prev
          return [...prev, { id: uid(), kind: "home-link" }]
        })
      }
      void assistantId
    },
    [setNickname]
  )

  const send = useCallback(
    async (text: string, opts?: { kickoff?: boolean; hideUser?: boolean }) => {
      const content = text.trim()
      if (busy && !opts?.kickoff) return
      setBusy(true)
      if (!opts?.hideUser && !opts?.kickoff && content) {
        setMessages((prev) => [...prev, { id: uid(), kind: "user", text: content }])
      }
      const assistantId = uid()
      setMessages((prev) => [...prev, { id: assistantId, kind: "tina", text: "", streaming: true }])
      try {
        await chatApi.sendStream({
          content: opts?.kickoff ? "开始引导" : content,
          session_id: sessionIdRef.current || undefined,
          kickoff: Boolean(opts?.kickoff),
          onChunk: (chunk) => {
            if (typeof chunk.session_id === "string") sessionIdRef.current = chunk.session_id
            if (chunk.event === "onboarding_ui" && chunk.item && typeof chunk.item === "object") {
              applyUi(chunk.item as OnboardingUiItem, assistantId)
            }
            if (chunk.event === "profile" && chunk.profile && typeof chunk.profile === "object") {
              const p = chunk.profile as { nickname?: string; has_goal?: boolean }
              if (p.nickname) setNickname(p.nickname)
              if (p.has_goal) setGoalSaved(true)
            }
            if (typeof chunk.content === "string" && chunk.reasoning_content !== true) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId && m.kind === "tina" ? { ...m, text: m.text + chunk.content } : m
                )
              )
            }
          },
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : "引导暂时不可用"
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId && m.kind === "tina" ? { ...m, text: m.text || `（${msg}）` } : m
          )
        )
      } finally {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId && m.kind === "tina" ? { ...m, streaming: false } : m))
        )
        setBusy(false)
        window.setTimeout(() => inputRef.current?.focus(), 40)
      }
    },
    [applyUi, busy, setNickname]
  )

  useEffect(() => {
    setRail(deriveRail(messages, completed))
  }, [messages, completed])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    const replay = searchParams.get("replay") === "1"
    onboardingApi
      .getSession(replay)
      .then((state) => {
        sessionIdRef.current = state.session_id
        if (state.profile?.nickname) setNickname(state.profile.nickname)
        if (state.profile?.has_goal) setGoalSaved(true)
        if (state.profile?.onboarding_status === "completed") setCompleted(true)
        const restored = historyToMessages(state.messages || [])
        if (restored.length) {
          setMessages(restored)
          return
        }
        void send("开始引导", { kickoff: true, hideUser: true })
      })
      .catch(() => {
        void send("开始引导", { kickoff: true, hideUser: true })
      })
  }, [searchParams, send, setNickname])

  const takeFile = async (file: File | undefined) => {
    if (!file || uploading) return
    const isPdf = file.name.toLowerCase().endsWith(".pdf")
    const forceScanned = isPdf
      ? window.confirm(`「${file.name}」是扫描件吗？\n\n确定 → 走 OCR\n取消 → 按普通 PDF`)
      : undefined
    setUploading(true)
    try {
      const res = await kbApi.upload(file, undefined, forceScanned)
      notifyCompletedTasks(res)
      setMessages((prev) =>
        prev.map((m) =>
          m.kind === "docs-card" && !m.locked ? { ...m, locked: true, fileName: file.name } : m
        )
      )
      finishDocsStep(file.name)
      await send(`我已经上传了资料：${file.name}`)
    } catch (err) {
      await send(err instanceof Error ? `上传失败：${err.message}` : "上传失败，我想再试一次或先跳过")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="h-dvh overflow-hidden flex flex-col bg-paper text-ink">
      <header className="h-16 px-6 sm:px-8 flex items-center justify-between border-b border-line shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <AppLogo size="sm" />
          <span className="font-semibold">知拾</span>
          <span className="text-caption text-ink-disabled hidden sm:inline">· 和 Tina 开始</span>
        </div>
        {goalSaved && (
          <button
            type="button"
            onClick={goHome}
            className="h-8 px-3 rounded-full border border-line bg-paper-2 text-caption text-ink-soft hover:text-sea"
          >
            进入工作台
          </button>
        )}
      </header>

      <div className="flex-1 flex min-h-0">
        <aside className="hidden md:flex w-[280px] shrink-0 border-r border-line bg-paper-2/40 flex-col p-5 overflow-y-auto">
          <p className="text-[11px] font-semibold text-sea">新手指引</p>
          <h1 className="mt-2 text-lg font-semibold">第一次使用知拾</h1>
          <p className="mt-2 text-caption leading-6 text-ink-soft">
            这就是和 Tina 聊天。左边只在她调用工具时亮起来，不是填表步骤。
          </p>
          <ol className="mt-6 space-y-2">
            {STEPS.map((s, i) => {
              const st = rail[s.id]
              const on = st === "on"
              const mark = st === "done" ? "✓" : st === "skip" ? "–" : String(i + 1)
              return (
                <li
                  key={s.id}
                  className={cn(
                    "flex gap-3 rounded-xl p-3 border",
                    on ? "border-sea/35 bg-sea-subtle" : "border-transparent"
                  )}
                >
                  <span
                    className={cn(
                      "w-8 h-8 rounded-full border border-line bg-paper text-caption font-semibold flex items-center justify-center shrink-0",
                      on ? "text-sea" : "text-ink-disabled"
                    )}
                  >
                    {mark}
                  </span>
                  <span>
                    <span className="block text-caption font-semibold">{s.label}</span>
                    <span className="block text-[11px] text-ink-disabled mt-0.5">{s.desc}</span>
                    {on && (s.id === "goal" || s.id === "docs") ? (
                      <span className="block text-[11px] text-sea mt-0.5">Tina 正在调用工具</span>
                    ) : on ? (
                      <span className="block text-[11px] text-sea mt-0.5">当前</span>
                    ) : null}
                    {st === "done" ? (
                      <span className="block text-[11px] text-ink-disabled mt-0.5">已完成</span>
                    ) : null}
                  </span>
                </li>
              )
            })}
          </ol>
        </aside>

        <div className="flex-1 flex flex-col min-w-0">
          <div ref={logRef} className="flex-1 overflow-y-auto px-6 sm:px-8 py-6 scroll-thin">
            <div className="max-w-[720px] mx-auto flex flex-col gap-5">
              {messages.map((m) => {
                if (m.kind === "user") {
                  return (
                    <div
                      key={m.id}
                      className="self-end bg-sea text-white rounded-2xl px-4 py-2.5 text-body leading-relaxed max-w-[80%]"
                    >
                      {m.text}
                    </div>
                  )
                }
                if (m.kind === "tina") {
                  return (
                    <p
                      key={m.id}
                      className={cn(
                        "text-body leading-relaxed whitespace-pre-wrap max-w-full",
                        m.streaming &&
                          "after:content-[''] after:inline-block after:w-1.5 after:h-3.5 after:ml-0.5 after:bg-sea after:align-[-2px] after:animate-pulse"
                      )}
                    >
                      {m.text}
                    </p>
                  )
                }
                if (m.kind === "goal-card") {
                  return (
                    <div
                      key={m.id}
                      className="bg-paper-2 border border-line border-l-[3px] border-l-sea rounded-2xl px-[18px] py-4"
                    >
                      <div className="text-[10px] font-semibold tracking-wide text-sea mb-2">
                        Tina 调用工具 · 确认学习目标
                      </div>
                      <h4 className="text-body font-semibold mb-1">是这个目标吗？</h4>
                      <p className="text-body leading-relaxed mb-3">{m.goal}</p>
                      <p className="text-[11px] text-ink-disabled mb-4">
                        确认后我会按这个方向帮你排练习。这句话已经写入数据库。
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={m.locked || busy}
                          onClick={() => {
                            setMessages((prev) => {
                              const locked = prev.map((x) =>
                                x.kind === "goal-card" ? { ...x, locked: true } : x
                              )
                              if (locked.some((x) => x.kind === "docs-card")) return locked
                              return [...locked, { id: uid(), kind: "docs-card" }]
                            })
                            void send("我确认这个目标，就是这个。")
                          }}
                          className="h-8 px-3 rounded-full bg-sea text-white text-caption disabled:opacity-40"
                        >
                          确认，就是这个
                        </button>
                        <button
                          type="button"
                          disabled={m.locked || busy}
                          onClick={() => void send("还想改一下")}
                          className="h-8 px-3 rounded-full border border-line bg-paper text-caption text-ink-soft disabled:opacity-40"
                        >
                          还想改一下
                        </button>
                      </div>
                    </div>
                  )
                }
                if (m.kind === "docs-card") {
                  return (
                    <div
                      key={m.id}
                      className="bg-paper-2 border border-line border-l-[3px] border-l-sea rounded-2xl px-[18px] py-4"
                    >
                      <div className="text-[10px] font-semibold tracking-wide text-sea mb-2">
                        Tina 调用工具 · 添加资料
                      </div>
                      <h4 className="text-body font-semibold mb-1">你有学习使用的资料吗？</h4>
                      <p className="text-[11px] text-ink-disabled mb-3">拖进来或点选一份，会上传到学习区。</p>
                      <div
                        className={cn(
                          "rounded-[14px] border-[1.5px] border-dashed border-line bg-paper px-3.5 py-[18px] text-center transition-colors",
                          m.locked
                            ? "cursor-default border-solid border-sea/45 bg-sea-subtle"
                            : "cursor-pointer hover:border-sea hover:bg-sea-subtle"
                        )}
                        onClick={() => {
                          if (m.locked || busy) return
                          fileRef.current?.click()
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault()
                          void takeFile(e.dataTransfer.files?.[0])
                        }}
                      >
                        {uploading ? (
                          <Loader2 className="w-5 h-5 mx-auto mb-2 text-sea animate-spin" />
                        ) : (
                          <UploadCloud className="w-5 h-5 mx-auto mb-2 text-sea" />
                        )}
                        <p className="text-body font-medium mb-0.5">
                          {m.fileName || (uploading ? "正在上传…" : "把文件拖到这里，或点选上传")}
                        </p>
                        <p className="text-[11px] text-ink-disabled">{m.locked ? "已处理" : "PDF、TXT、MD、DOCX"}</p>
                      </div>
                      <button
                        type="button"
                        disabled={m.locked || busy || uploading}
                        onClick={() => {
                          finishDocsStep()
                          void send("先跳过资料。")
                        }}
                        className="mt-3 h-8 px-3 rounded-full border border-line bg-paper text-caption text-ink-soft disabled:opacity-40"
                      >
                        先跳过
                      </button>
                    </div>
                  )
                }
                if (m.kind === "leave" || m.kind === "home-link") {
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={goHome}
                      className="inline-flex h-8 px-4 rounded-full bg-sea text-white text-caption items-center w-fit"
                    >
                      去首页
                      <ArrowRight className="w-3.5 h-3.5 ml-1" />
                    </button>
                  )
                }
                return null
              })}
            </div>
          </div>

          <div className="px-6 sm:px-8 pt-2 pb-5 shrink-0">
            <form
              className="max-w-[720px] mx-auto"
              onSubmit={(e) => {
                e.preventDefault()
                const text = input.trim()
                if (!text || busy) return
                setInput("")
                void send(text)
              }}
            >
              <div className="rounded-[24px] border border-line bg-paper-2/80">
                <div className="flex items-end gap-2 pl-4 pr-2 py-2">
                  <textarea
                    ref={inputRef}
                    rows={1}
                    value={input}
                    disabled={busy}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        ;(e.currentTarget.form as HTMLFormElement | null)?.requestSubmit()
                      }
                    }}
                    placeholder="回复 Tina…"
                    className="flex-1 py-2 bg-transparent border-0 text-body resize-none focus:outline-none focus:ring-0 placeholder:text-ink-disabled disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={busy || !input.trim()}
                    className="w-9 h-9 rounded-full bg-sea text-white flex items-center justify-center shrink-0 mb-0.5 disabled:opacity-40"
                  >
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <p className="text-center text-[11px] text-ink-disabled mt-2">Enter 发送 · Shift + Enter 换行</p>
            </form>
          </div>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        accept=".pdf,.txt,.md,.docx,.pptx,.csv,.json,.html,.htm"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ""
          void takeFile(file)
        }}
      />
    </div>
  )
}
