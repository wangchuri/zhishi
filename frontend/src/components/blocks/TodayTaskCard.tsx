import type { ReactNode } from "react"
import { BookOpen, FileUp, GraduationCap, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SealMark } from "@/components/decor/PaperMotifs"
import { cn } from "@/lib/utils"
import type { DailyTaskItem } from "@/types"

const KIND = {
  upload: { label: "上传", Icon: FileUp },
  generate: { label: "出题", Icon: Sparkles },
  quiz: { label: "刷题", Icon: BookOpen },
  learn: { label: "学习", Icon: GraduationCap },
} as const

function kindMeta(kind: string) {
  return KIND[kind as keyof typeof KIND] || { label: "任务", Icon: BookOpen }
}

function localISODate(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function TodayTaskCard({
  task,
  index,
  onGo,
  onRestore,
  restoring,
  compact,
}: {
  task: DailyTaskItem
  index: number
  onGo: () => void
  onRestore?: () => void
  restoring?: boolean
  compact?: boolean
}) {
  const done = task.status === "completed"
  const expired = task.status === "expired"
  const restored =
    task.status === "pending" && (task.for_date || "").slice(0, 10) < localISODate()
  const meta = kindMeta(task.kind)
  const Icon = meta.Icon
  const n = String(index + 1).padStart(2, "0")

  if (compact) {
    return (
      <button
        type="button"
        onClick={onGo}
        className={cn(
          "group relative w-full text-left overflow-hidden rounded-2xl border bg-paper p-3.5 transition-all duration-200",
          expired
            ? "border-danger/45 bg-danger-soft hover:border-danger/70"
            : "border-line hover:border-sea/35 hover:shadow-[0_6px_18px_-8px_rgba(31,92,90,0.28)]",
          done && "opacity-75",
        )}
      >
        <div className="paper-grain pointer-events-none absolute inset-0 opacity-40" />
        <div className="relative flex items-start gap-2.5">
          <span
            className={cn(
              "mt-0.5 w-7 h-7 rounded-full border flex items-center justify-center shrink-0 font-display text-[11px]",
              done
                ? "border-sea/40 text-sea bg-sea-subtle"
                : expired
                  ? "border-danger/40 text-danger bg-danger-soft"
                  : "border-line text-sea bg-paper-2",
            )}
          >
            {done ? "✓" : n}
          </span>
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "text-caption font-medium",
                done && "line-through text-ink-soft",
                expired ? "text-danger" : "text-ink",
              )}
            >
              {task.title}
            </p>
            {expired ? <p className="text-[11px] text-danger mt-0.5">已超时</p> : null}
            {restored ? <p className="text-[11px] text-sea mt-0.5">已恢复</p> : null}
          </div>
        </div>
      </button>
    )
  }

  return (
    <article
      className={cn(
        "task-slip group relative overflow-hidden rounded-2xl border bg-paper",
        "shadow-[0_4px_20px_-2px_rgba(20,33,43,0.04)] transition-all duration-200",
        expired
          ? "border-danger/50 bg-danger-soft hover:border-danger/70"
          : "border-line hover:-translate-y-0.5 hover:shadow-[0_10px_28px_-12px_rgba(31,92,90,0.22)] hover:border-sea/30",
        done && "task-slip-done",
      )}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="paper-grain pointer-events-none absolute inset-0 opacity-50" />
      <div className="paper-ruled pointer-events-none absolute inset-0 opacity-60" />
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 w-[3px]",
          expired ? "bg-danger" : "bg-sea/55",
        )}
      />

      <div className="relative flex items-stretch gap-4 p-4 pl-5">
        <div className="flex flex-col items-center shrink-0 w-11 pt-0.5">
          <span
            className={cn(
              "font-display text-[1.15rem] leading-none tabular-nums",
              expired ? "text-danger" : "text-sea",
            )}
          >
            {n}
          </span>
          <span
            className={cn(
              "mt-2 w-8 h-8 rounded-full flex items-center justify-center",
              expired ? "bg-danger-soft text-danger" : "bg-sea-subtle text-sea",
            )}
          >
            <Icon className="w-3.5 h-3.5" strokeWidth={2} />
          </span>
          <span
            className={cn(
              "mt-1 text-[10px] tracking-wide",
              expired ? "text-danger/80" : "text-ink-disabled",
            )}
          >
            {meta.label}
          </span>
        </div>

        <div className="min-w-0 flex-1 py-0.5">
          <h3
            className={cn(
              "text-body font-medium leading-snug",
              done && "text-ink-soft line-through decoration-sea/40",
              expired ? "text-danger" : "text-ink",
            )}
          >
            {task.title}
          </h3>
          {task.description ? (
            <p className={cn("text-caption mt-1.5 leading-relaxed", expired ? "text-danger/80" : "text-ink-disabled")}>
              {task.description}
            </p>
          ) : null}
          {expired ? (
            <p className="text-caption text-danger mt-1.5">已超时。恢复后今天内再给一次机会。</p>
          ) : null}
          {restored ? (
            <p className="text-caption text-sea mt-1.5">已恢复，今天结束前做完即可。</p>
          ) : null}
        </div>

        <div className="shrink-0 self-center flex flex-col items-end gap-2">
          {done ? (
            <SealMark className="task-seal w-12 h-12 text-sea" />
          ) : expired && onRestore ? (
            <Button
              size="sm"
              variant="outline"
              className="rounded-full border-danger/50 text-danger hover:border-danger hover:text-danger"
              disabled={restoring}
              onClick={onRestore}
            >
              {restoring ? "恢复中…" : "恢复"}
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="rounded-full" onClick={onGo}>
              {expired ? "去看看" : task.action || "去完成"}
            </Button>
          )}
        </div>
      </div>
    </article>
  )
}

export function TaskSpine({ children }: { children: ReactNode }) {
  return <div className="space-y-3">{children}</div>
}
