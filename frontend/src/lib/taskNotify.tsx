import { toast } from "sonner"
import { SealMark } from "@/components/decor/PaperMotifs"

export type CompletedTaskItem = { id: string; title: string }

export const TASKS_EVENT = "zhishi-tasks"

const notified = new Set<string>()
let seeded = false
let dayCompleteNotified = false

function paperTaskToast(title: string, description?: string) {
  toast.custom(
    (id) => (
      <div
        className="relative w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-sea/30 bg-paper px-4 py-3.5 shadow-[0_8px_28px_-12px_rgba(20,33,43,0.18)]"
        onClick={() => toast.dismiss(id)}
        role="status"
      >
        <div className="paper-grain pointer-events-none absolute inset-0 opacity-40" />
        <div className="relative flex items-start gap-3">
          <SealMark className="mt-0.5 h-9 w-9 shrink-0 text-sea" label="成" />
          <div className="min-w-0 flex-1">
            <p className="font-display text-body text-ink">{title}</p>
            {description ? (
              <p className="mt-0.5 text-caption text-ink-soft line-clamp-2">{description}</p>
            ) : null}
          </div>
        </div>
      </div>
    ),
    { duration: 4200, position: "top-right" },
  )
}

export function notifyDayComplete(dayComplete?: boolean) {
  if (!dayComplete || dayCompleteNotified) return
  dayCompleteNotified = true
  paperTaskToast("任务完成！", "你离目标又近了一步")
}

export function notifyCompletedTasks(payload?: { completed_tasks?: CompletedTaskItem[] } | null) {
  const items = payload?.completed_tasks
  if (!items?.length) return
  for (const t of items) {
    if (!t?.id || notified.has(t.id)) continue
    notified.add(t.id)
    paperTaskToast("该任务已经完成", t.title)
  }
}

export function seedCompletedTasks(tasks?: Array<{ id: string; status?: string; title?: string }> | null) {
  for (const t of tasks || []) {
    if (t.status === "completed" && t.id) notified.add(t.id)
  }
  seeded = true
}

export function noticeTodayTasks(res?: {
  tasks?: Array<{ id: string; status?: string; title?: string }>
  completed_tasks?: CompletedTaskItem[] | null
  day_complete?: boolean
  refill_pending?: boolean
} | null) {
  if (!res) return
  if (!res.day_complete) dayCompleteNotified = false
  notifyDayComplete(res.day_complete)
  const fromEvent = res.completed_tasks || []
  const fromList = (res.tasks || []).filter((t) => t.status === "completed")
  if (!seeded) {
    const fresh = new Set(fromEvent.map((t) => t.id))
    for (const t of fromList) {
      if (t.id && !fresh.has(t.id)) notified.add(t.id)
    }
    seeded = true
    notifyCompletedTasks({ completed_tasks: fromEvent })
  } else {
    notifyCompletedTasks({
      completed_tasks: [
        ...fromEvent,
        ...fromList.map((t) => ({ id: t.id, title: t.title || "" })),
      ],
    })
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(TASKS_EVENT, { detail: res }))
  }
}
