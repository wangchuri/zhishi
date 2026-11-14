import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowRight, ChevronDown, Loader2, Play, RotateCcw } from "lucide-react"
import { AppShell } from "@/components/layout/AppShell"
import { PageHeader } from "@/components/blocks/PageHeader"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { quizApi } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { QuizSessionSummary } from "@/types"

/** 会话名：优先自定义标题，其次文档名 */
function sessionTitle(session: QuizSessionSummary): string {
  return session.title || session.document_name || "刷题会话"
}

/** 会话副标题：文档名 · 进度 · 时间 */
function sessionMeta(session: QuizSessionSummary): string {
  const parts: string[] = []
  if (session.title && session.document_name) parts.push(session.document_name)
  parts.push(`已答 ${session.answered_count || 0}/${session.total_questions || 0} 题`)
  const when = session.status === "completed" ? session.finished_at : session.started_at
  if (when) parts.push(formatWhen(when))
  return parts.join(" · ")
}

function formatWhen(value?: string | null): string {
  if (!value) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`
  const sameYear = d.getFullYear() === now.getFullYear()
  const md = `${d.getMonth() + 1} 月 ${d.getDate()} 日`
  return sameYear ? `${md} ${hm}` : `${d.getFullYear()} 年 ${md}`
}

function ProgressBar({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0
  return (
    <div className="h-1.5 w-full rounded-full bg-line-soft overflow-hidden">
      <div className="h-full rounded-full bg-sea transition-all" style={{ width: `${pct}%` }} />
    </div>
  )
}

function sessionHref(session: QuizSessionSummary): string {
  return `/quiz/session?session_id=${encodeURIComponent(session.id)}`
}

/**
 * 独立刷题页：顶部最显眼的是「继续最近刷题」，下面是历史刷题会话。
 * 已完成的会话折叠起来，默认收起，避免把进行中的会话挤下去。
 */
export function QuizPracticePage() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<QuizSessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [completedOpen, setCompletedOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    quizApi
      .listSessionHistory(40)
      .then((res) => {
        if (cancelled) return
        setSessions(res.sessions || [])
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setSessions([])
        setError(err instanceof Error ? err.message : "刷题记录加载失败")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const retry = () => {
    setLoading(true)
    setReloadKey((k) => k + 1)
  }

  const { latestActive, otherActive, completed } = useMemo(() => {
    const active = sessions.filter(
      (s) => s.status !== "completed" && (s.total_questions || 0) > 0,
    )
    return {
      latestActive: active[0],
      otherActive: active.slice(1),
      completed: sessions.filter((s) => s.status === "completed"),
    }
  }, [sessions])

  return (
    <AppShell maxWidth={720}>
      <PageHeader title="刷题" subtitle="接着上次的进度继续，或回看历史会话">
        <Button variant="secondary" size="md" onClick={() => navigate("/quiz")}>
          去资料
          <ArrowRight className="w-4 h-4" />
        </Button>
      </PageHeader>

      {error ? (
        <div className="rounded-2xl border border-danger/30 bg-danger-soft px-4 py-3.5">
          <p className="text-body font-medium text-danger">刷题记录没能加载</p>
          <p className="mt-1 text-small text-ink-secondary break-words">{error}</p>
          <p className="mt-1.5 text-caption text-ink-soft">
            如果刚更新过版本，重启一次后端服务再试（刷题页用的是新接口
            <code className="mx-1 px-1 rounded bg-paper/70">/api/v1/quiz/session-history</code>
            ）。
          </p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={retry}>
            重试
          </Button>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-body text-ink-soft">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>正在加载刷题记录…</span>
        </div>
      ) : !latestActive ? (
        <div className="space-y-6">
          <EmptyState
            icon={Play}
            title="现在没有进行中的刷题"
            description="去资料里挑一本书或一组题，开始一次新的练习。"
            primaryAction={{ label: "去资料挑题", onClick: () => navigate("/quiz") }}
          />
          {completed.length > 0 && (
            <CompletedSection
              sessions={completed}
              open={completedOpen}
              onToggle={() => setCompletedOpen((v) => !v)}
            />
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* 继续最近刷题：整页最显眼的一块 */}
          <div className="rounded-2xl border border-sea/30 bg-sea-subtle/60 p-5 sm:p-6">
            <p className="text-caption font-medium text-sea">继续最近刷题</p>
            <h2 className="mt-1.5 text-page-title text-ink-primary break-words">
              {sessionTitle(latestActive)}
            </h2>
            <p className="mt-1 text-small text-ink-secondary">{sessionMeta(latestActive)}</p>
            <div className="mt-4">
              <ProgressBar
                value={latestActive.answered_count || 0}
                total={latestActive.total_questions || 0}
              />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button size="lg" onClick={() => navigate(sessionHref(latestActive))}>
                <Play className="w-4 h-4" strokeWidth={2} />
                继续刷题
              </Button>
              <Button variant="ghost" size="md" onClick={() => navigate("/quiz")}>
                换一本书
              </Button>
            </div>
          </div>

          {otherActive.length > 0 && (
            <div>
              <h3 className="text-card-title font-semibold text-ink-primary mb-3">
                其他没刷完的（{otherActive.length}）
              </h3>
              <div className="space-y-3">
                {otherActive.map((s) => (
                  <SessionRow key={s.id} session={s} onOpen={() => navigate(sessionHref(s))} />
                ))}
              </div>
            </div>
          )}

          {completed.length > 0 && (
            <CompletedSection
              sessions={completed}
              open={completedOpen}
              onToggle={() => setCompletedOpen((v) => !v)}
            />
          )}
        </div>
      )}
    </AppShell>
  )
}

/** 已完成的会话：默认折叠，点标题行展开 */
function CompletedSection({
  sessions,
  open,
  onToggle,
}: {
  sessions: QuizSessionSummary[]
  open: boolean
  onToggle: () => void
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-2 rounded-2xl border border-line bg-paper px-4 py-3 text-left hover:border-sea/40 transition-colors"
      >
        <RotateCcw className="w-4 h-4 text-ink-soft shrink-0" strokeWidth={2} />
        <span className="min-w-0 flex-1">
          <span className="text-body font-medium text-ink-primary">已刷完的会话</span>
          <span className="ml-2 text-caption text-ink-soft">{sessions.length} 场</span>
        </span>
        <span className="text-caption text-ink-soft shrink-0">{open ? "收起" : "展开"}</span>
        <ChevronDown
          className={cn("w-4 h-4 text-ink-soft shrink-0 transition-transform", open && "rotate-180")}
          strokeWidth={2}
        />
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {sessions.map((s) => (
            <SessionRow key={s.id} session={s} />
          ))}
        </div>
      )}
    </div>
  )
}

function SessionRow({
  session,
  onOpen,
}: {
  session: QuizSessionSummary
  onOpen?: () => void
}) {
  const done = session.status === "completed"
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-ink truncate">{sessionTitle(session)}</p>
        <p className="text-caption text-ink-soft mt-0.5">{sessionMeta(session)}</p>
      </div>
      <span className={cn("text-caption shrink-0", done ? "text-ink-soft" : "text-sea")}>
        {done ? "已完成" : "继续"}
      </span>
    </>
  )
  const base = "w-full flex items-center gap-3 rounded-2xl border border-line bg-paper px-4 py-3.5 text-left"

  // 已完成的会话只做展示：进去会从第 1 题重刷，这里不提供入口
  if (done || !onOpen) {
    return <div className={cn(base, "border-line-soft")}>{body}</div>
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(base, "hover:border-sea/40 transition-colors")}
    >
      {body}
    </button>
  )
}
