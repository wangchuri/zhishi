import { useMemo, useState } from "react"
import { ArrowRight, ChevronDown, Loader2, Play, RotateCcw } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { sessionMeta, sessionTitle } from "@/features/quiz/quizSessionFormat"
import type { QuizSessionSummary } from "@/types"

function ProgressBar({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0
  return (
    <div className="h-1.5 w-full rounded-full bg-line-soft overflow-hidden">
      <div className="h-full rounded-full bg-sea transition-all" style={{ width: `${pct}%` }} />
    </div>
  )
}

interface QuizSessionPickerProps {
  sessions: QuizSessionSummary[]
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  /** 选中一场会话（进行中或已完成） */
  onPick: (session: QuizSessionSummary) => void
  /** 没有会话时的「去资料」入口 */
  onOpenLibrary?: () => void
  className?: string
}

/**
 * 刷题会话选择：顶部最显眼的是「继续最近刷题」，下面是其他未完成会话，
 * 已刷完的折叠起来。刷题页与 Tina 的右侧刷题面板共用这一份。
 */
export function QuizSessionPicker({
  sessions,
  loading,
  error,
  onRetry,
  onPick,
  onOpenLibrary,
  className,
}: QuizSessionPickerProps) {
  const [completedOpen, setCompletedOpen] = useState(false)

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

  if (error) {
    return (
      <div className={cn("rounded-2xl border border-danger/30 bg-danger-soft px-4 py-3.5", className)}>
        <p className="text-body font-medium text-danger">刷题记录没能加载</p>
        <p className="mt-1 text-small text-ink-secondary break-words">{error}</p>
        {onRetry && (
          <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
            重试
          </Button>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className={cn("flex items-center justify-center gap-2 py-10 text-small text-ink-soft", className)}>
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>正在加载刷题记录…</span>
      </div>
    )
  }

  if (!latestActive) {
    return (
      <div className={className}>
        <EmptyState
          icon={Play}
          title="现在没有进行中的刷题"
          description="去资料里挑一本书或一组题，开始一次新的练习。"
          primaryAction={
            onOpenLibrary ? { label: "去资料挑题", onClick: onOpenLibrary } : undefined
          }
          size="sm"
        />
        {completed.length > 0 && (
          <CompletedSection
            sessions={completed}
            open={completedOpen}
            onToggle={() => setCompletedOpen((v) => !v)}
            onPick={onPick}
          />
        )}
      </div>
    )
  }

  return (
    <div className={cn("space-y-4", className)}>
      <div className="rounded-2xl border border-sea/30 bg-sea-subtle/60 p-4">
        <p className="text-caption font-medium text-sea">继续最近刷题</p>
        <h2 className="mt-1 text-card-title font-semibold text-ink-primary break-words">
          {sessionTitle(latestActive)}
        </h2>
        <p className="mt-1 text-small text-ink-secondary">{sessionMeta(latestActive)}</p>
        <div className="mt-3">
          <ProgressBar
            value={latestActive.answered_count || 0}
            total={latestActive.total_questions || 0}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="md" onClick={() => onPick(latestActive)}>
            <Play className="w-4 h-4" strokeWidth={2} />
            继续刷题
          </Button>
          {onOpenLibrary && (
            <Button variant="ghost" size="sm" onClick={onOpenLibrary}>
              换一本书
              <ArrowRight className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {otherActive.length > 0 && (
        <div>
          <h3 className="text-small font-medium text-ink-primary mb-2">
            其他没刷完的（{otherActive.length}）
          </h3>
          <div className="space-y-2">
            {otherActive.map((s) => (
              <SessionRow key={s.id} session={s} onOpen={() => onPick(s)} />
            ))}
          </div>
        </div>
      )}

      {completed.length > 0 && (
        <CompletedSection
          sessions={completed}
          open={completedOpen}
          onToggle={() => setCompletedOpen((v) => !v)}
          onPick={onPick}
        />
      )}
    </div>
  )
}

/** 已完成的会话：默认折叠，点标题行展开 */
function CompletedSection({
  sessions,
  open,
  onToggle,
  onPick,
}: {
  sessions: QuizSessionSummary[]
  open: boolean
  onToggle: () => void
  onPick: (session: QuizSessionSummary) => void
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-2 rounded-2xl border border-line bg-paper px-3.5 py-2.5 text-left hover:border-sea/40 transition-colors"
      >
        <RotateCcw className="w-4 h-4 text-ink-soft shrink-0" strokeWidth={2} />
        <span className="min-w-0 flex-1">
          <span className="text-small font-medium text-ink-primary">已刷完的会话</span>
          <span className="ml-2 text-caption text-ink-soft">{sessions.length} 场</span>
        </span>
        <span className="text-caption text-ink-soft shrink-0">{open ? "收起" : "展开"}</span>
        <ChevronDown
          className={cn("w-4 h-4 text-ink-soft shrink-0 transition-transform", open && "rotate-180")}
          strokeWidth={2}
        />
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {sessions.map((s) => (
            <SessionRow key={s.id} session={s} onOpen={() => onPick(s)} />
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
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full flex items-center gap-3 rounded-2xl border border-line bg-paper px-3.5 py-3 text-left hover:border-sea/40 transition-colors"
    >
      <div className="min-w-0 flex-1">
        <p className="text-small font-medium text-ink truncate">{sessionTitle(session)}</p>
        <p className="text-caption text-ink-soft mt-0.5">{sessionMeta(session)}</p>
      </div>
      <span className="text-caption shrink-0 text-sea">继续</span>
    </button>
  )
}
