import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { AppShell } from "@/components/layout/AppShell"
import { SectionHeader } from "@/components/blocks/SectionHeader"
import { TaskSpine, TodayTaskCard } from "@/components/blocks/TodayTaskCard"
import { EmptyNotes, MistRings } from "@/components/decor/PaperMotifs"
import { tasksApi } from "@/lib/api"
import { noticeTodayTasks, TASKS_EVENT } from "@/lib/taskNotify"
import { DayCompleteCard, TaskRefillHint } from "@/components/blocks/DayCompleteCard"
import type { DailyTaskItem, TodayTasksResult } from "@/types"

function localISODate(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function dayLabel(iso: string) {
  const parts = iso.split("-").map(Number)
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return iso
  const d = new Date(parts[0], parts[1] - 1, parts[2])
  const today = localISODate()
  const y = new Date()
  y.setDate(y.getDate() - 1)
  const yesterday = localISODate(y)
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  const week = d.toLocaleDateString("zh-CN", { weekday: "short" })
  if (iso === today) return `今天 · ${md}`
  if (iso === yesterday) return `昨天 · ${md}`
  return `${md} ${week}`
}

export function TasksPage() {
  const navigate = useNavigate()
  const [tasks, setTasks] = useState<DailyTaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  const [dayComplete, setDayComplete] = useState(false)
  const [refillPending, setRefillPending] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([tasksApi.getHistory(60), tasksApi.getToday()])
      .then(([hist, today]) => {
        if (cancelled) return
        setTasks(hist.tasks || [])
        noticeTodayTasks(hist)
        noticeTodayTasks(today)
        setDayComplete(Boolean(today.day_complete))
        setRefillPending(Boolean(today.refill_pending))
      })
      .catch(() => {
        if (!cancelled) toast.error("任务记录打不开")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onTasks = (ev: Event) => {
      const res = (ev as CustomEvent<TodayTasksResult>).detail
      if (!res) return
      setDayComplete(Boolean(res.day_complete))
      setRefillPending(Boolean(res.refill_pending))
      if (!res.tasks) return
      const today = localISODate()
      setTasks((prev) => {
        const rest = prev.filter((t) => (t.for_date || "").slice(0, 10) !== today)
        return [...res.tasks, ...rest]
      })
    }
    window.addEventListener(TASKS_EVENT, onTasks)
    return () => window.removeEventListener(TASKS_EVENT, onTasks)
  }, [])

  const groups = useMemo(() => {
    const map = new Map<string, DailyTaskItem[]>()
    for (const task of tasks) {
      const key = (task.for_date || "").slice(0, 10) || "未知日期"
      const list = map.get(key)
      if (list) list.push(task)
      else map.set(key, [task])
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [tasks])

  const expiredCount = tasks.filter((t) => t.status === "expired").length
  const doneCount = tasks.filter((t) => t.status === "completed").length

  const restore = async (task: DailyTaskItem) => {
    if (restoringId) return
    setRestoringId(task.id)
    try {
      const res = await tasksApi.restore(task.id)
      setTasks((prev) => prev.map((row) => (row.id === res.task.id ? res.task : row)))
      noticeTodayTasks({
        tasks: [res.task],
        completed_tasks: res.completed_tasks,
      })
      if (res.task.status === "pending") {
        toast.success("已恢复，今天内再给一次机会", { description: res.task.title })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "恢复失败")
    } finally {
      setRestoringId(null)
    }
  }

  return (
    <AppShell maxWidth={880}>
      <section className="relative overflow-hidden rounded-3xl border border-line bg-paper mb-8 short:mb-5 px-6 py-6 shadow-[0_8px_28px_-16px_rgba(20,33,43,0.12)]">
        <div className="paper-grain pointer-events-none absolute inset-0 opacity-50" />
        <MistRings className="animate-mist pointer-events-none absolute -right-10 -top-12 w-48 h-48 text-sea" />
        <div className="relative">
          <p className="text-[11px] font-semibold tracking-wide text-sea mb-2">过去的便签</p>
          <h1 className="font-display text-[1.85rem] md:text-[2.1rem] leading-tight text-ink mb-2">任务</h1>
          <p className="text-body text-ink-soft max-w-xl">
            每天的任务都会留着。超时的用红色标出来，点恢复可以再给自己一次机会；恢复时会检查是不是其实已经做完了。
          </p>
          <p className="text-caption text-ink-disabled mt-3">
            {loading
              ? "正在翻以前的便签…"
              : `近 60 天 ${tasks.length} 件 · 完成 ${doneCount}${expiredCount ? ` · 超时 ${expiredCount}` : ""}`}
          </p>
        </div>
      </section>

      {loading ? (
        <div className="py-16 text-center text-caption text-ink-disabled">纸页摊开，稍等一下</div>
      ) : !tasks.length ? (
        <div className="relative overflow-hidden rounded-2xl border border-dashed border-line bg-paper/70 px-5 py-12 text-center">
          <EmptyNotes className="mx-auto mb-3 w-28 h-16" />
          <p className="text-body text-ink-soft">还没有任务记录</p>
          <p className="text-caption text-ink-disabled mt-1">首页保存目标之后，Tina 会开始写便签。</p>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map(([day, items]) => (
            <section key={day}>
              <SectionHeader title={dayLabel(day)} subtitle={`${items.length} 件`}>
                {items.some((t) => t.status === "expired") ? (
                  <span className="text-[11px] text-danger">有超时未完成</span>
                ) : null}
              </SectionHeader>
              <div className="space-y-3">
                {day === localISODate() && dayComplete ? <DayCompleteCard /> : null}
                {day === localISODate() && refillPending ? <TaskRefillHint /> : null}
                <TaskSpine>
                  {items.map((task, i) => (
                    <TodayTaskCard
                      key={task.id}
                      task={task}
                      index={i}
                      onGo={() => navigate(task.href || "/quiz")}
                      onRestore={task.status === "expired" ? () => void restore(task) : undefined}
                      restoring={restoringId === task.id}
                    />
                  ))}
                </TaskSpine>
              </div>
            </section>
          ))}
        </div>
      )}
    </AppShell>
  )
}
