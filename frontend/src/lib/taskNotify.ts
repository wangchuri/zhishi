import { toast } from "sonner"

export type CompletedTaskItem = { id: string; title: string }

export const TASKS_EVENT = "zhishi-tasks"

const notified = new Set<string>()
let seeded = false

export function notifyCompletedTasks(payload?: { completed_tasks?: CompletedTaskItem[] } | null) {
  const items = payload?.completed_tasks
  if (!items?.length) return
  for (const t of items) {
    if (!t?.id || notified.has(t.id)) continue
    notified.add(t.id)
    toast.success("该任务已经完成！", { description: t.title })
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
