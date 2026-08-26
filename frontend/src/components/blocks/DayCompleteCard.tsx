import { useState, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { SealMark } from "@/components/decor/PaperMotifs"
import { TaskAgentWriting } from "@/components/blocks/TaskAgentWriting"
import { TodayTaskCard, TaskSpine } from "@/components/blocks/TodayTaskCard"
import { cn } from "@/lib/utils"
import type { DailyTaskItem } from "@/types"

export function DayCompleteCard({ compact }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-sea/35 bg-sea-subtle px-3.5 py-3.5 text-center">
        <p className="text-caption font-medium text-sea">任务完成！</p>
        <p className="text-[11px] text-ink-soft mt-0.5">你离目标又近了一步</p>
      </div>
    )
  }
  return (
    <div className="relative overflow-hidden rounded-2xl border border-sea/35 bg-paper px-5 py-8 text-center shadow-[0_4px_20px_-2px_rgba(20,33,43,0.05)]">
      <div className="paper-grain pointer-events-none absolute inset-0 opacity-40" />
      <div className="relative">
        <SealMark className="mx-auto mb-3 w-14 h-14 text-sea" />
        <p className="font-display text-[1.35rem] text-ink">任务完成！</p>
        <p className="text-body text-ink-soft mt-1.5">你离目标又近了一步</p>
      </div>
    </div>
  )
}

export function TaskRefillHint({ compact }: { compact?: boolean }) {
  return (
    <TaskAgentWriting
      compact={compact}
      title="Tina 正在看还要不要再给任务"
    />
  )
}

export function TodayTasksDoneSummary({
  tasks,
  onGo,
  compact,
}: {
  tasks: DailyTaskItem[]
  onGo: (task: DailyTaskItem) => void
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const done = tasks.filter((t) => t.status === "completed")
  if (!done.length) return null

  return (
    <div className="rounded-2xl border border-line bg-paper/80 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full flex items-center justify-between gap-2 text-left transition-colors hover:bg-paper-2/60",
          compact ? "px-3.5 py-2.5" : "px-4 py-3",
        )}
      >
        <span className={compact ? "text-caption text-ink-soft" : "text-body text-ink-soft"}>
          今天完成了 {done.length} 件
        </span>
        <ChevronDown
          className={cn("w-4 h-4 text-ink-disabled shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div className={cn("border-t border-line", compact ? "p-2 space-y-2" : "p-3")}>
          {compact ? (
            <div className="space-y-2">
              {done.map((task, i) => (
                <TodayTaskCard key={task.id} task={task} index={i} compact onGo={() => onGo(task)} />
              ))}
            </div>
          ) : (
            <TaskSpine>
              {done.map((task, i) => (
                <TodayTaskCard key={task.id} task={task} index={i} onGo={() => onGo(task)} />
              ))}
            </TaskSpine>
          )}
        </div>
      ) : null}
    </div>
  )
}

export function TodayTaskSection({
  tasks,
  dayComplete,
  onGo,
  compact,
  children,
}: {
  tasks: DailyTaskItem[]
  dayComplete?: boolean
  onGo: (task: DailyTaskItem) => void
  compact?: boolean
  children?: ReactNode
}) {
  const pending = tasks.filter((t) => t.status === "pending")
  const expired = tasks.filter((t) => t.status === "expired")
  const active = [...pending, ...expired]

  if (dayComplete) {
    return (
      <div className={compact ? "space-y-2" : "space-y-3"}>
        {children}
        <TodayTasksDoneSummary tasks={tasks} onGo={onGo} compact={compact} />
      </div>
    )
  }

  if (!active.length && !tasks.length) return null

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {children}
      {active.length ? (
        compact ? (
          <div className="space-y-2">
            {active.map((task, i) => (
              <TodayTaskCard key={task.id} task={task} index={i} compact onGo={() => onGo(task)} />
            ))}
          </div>
        ) : (
          <TaskSpine>
            {active.map((task, i) => (
              <TodayTaskCard key={task.id} task={task} index={i} onGo={() => onGo(task)} />
            ))}
          </TaskSpine>
        )
      ) : null}
      {tasks.some((t) => t.status === "completed") ? (
        <TodayTasksDoneSummary tasks={tasks} onGo={onGo} compact={compact} />
      ) : null}
    </div>
  )
}
