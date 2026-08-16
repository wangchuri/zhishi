import { useState, useEffect, useMemo, useCallback } from "react"
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  CheckCircle2,
  CalendarDays,
} from "lucide-react"
import { AppShell } from "@/components/layout/AppShell"
import { PageHeader } from "@/components/blocks/PageHeader"
import { Card } from "@/components/ui/card"
import { Chip } from "@/components/ui/chip"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { plansApi } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { PlanTask, StudyPlan } from "@/types"

const WEEK_LABELS = ["日", "一", "二", "三", "四", "五", "六"]

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function todayKey(): string {
  return dateKey(new Date())
}

function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

function buildCalendar(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1)
  const startWeekday = first.getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = []
  for (let i = 0; i < startWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

export function PlansPage() {
  const today = new Date()
  const [cursor, setCursor] = useState<Date>(new Date(today.getFullYear(), today.getMonth(), 1))
  const [selected, setSelected] = useState<string>(todayKey())
  const [plans, setPlans] = useState<StudyPlan[]>([])
  const [tasks, setTasks] = useState<PlanTask[]>([])
  const [planFilter, setPlanFilter] = useState("all")

  const [showNewPlan, setShowNewPlan] = useState(false)
  const [planTitle, setPlanTitle] = useState("")
  const [planGoal, setPlanGoal] = useState("")
  const [showNewTask, setShowNewTask] = useState(false)
  const [taskTitle, setTaskTitle] = useState("")
  const [taskPlan, setTaskPlan] = useState("")
  const [saving, setSaving] = useState(false)

  const loadPlans = useCallback(() => {
    plansApi.list().then((res) => setPlans(res.plans || [])).catch(() => setPlans([]))
  }, [])

  const loadMonth = useCallback((month: string) => {
    return plansApi
      .listTasksByMonth(month)
      .then(setTasks)
      .catch(() => setTasks([]))
  }, [])

  useEffect(() => {
    loadPlans()
    loadMonth(monthKeyOf(cursor))
  }, [loadPlans, loadMonth, cursor])

  const tasksByDate = useMemo(() => {
    const map: Record<string, PlanTask[]> = {}
    for (const t of tasks) {
      if (!t.due_date) continue
      const key = t.due_date
      if (!map[key]) map[key] = []
      map[key].push(t)
    }
    return map
  }, [tasks])

  const filteredTasks = useMemo(() => {
    const list = tasksByDate[selected] ?? []
    if (planFilter === "all") return list
    return list.filter((t) => t.plan_id === planFilter)
  }, [tasksByDate, selected, planFilter])

  const selectedCount = filteredTasks.length
  const selectedDone = filteredTasks.filter((t) => t.done).length

  const cells = useMemo(
    () => buildCalendar(cursor.getFullYear(), cursor.getMonth()),
    [cursor]
  )

  const handleNewPlan = async () => {
    const t = planTitle.trim()
    if (!t || saving) return
    setSaving(true)
    try {
      await plansApi.create({ title: t, goal: planGoal.trim() || undefined })
      setPlanTitle("")
      setPlanGoal("")
      setShowNewPlan(false)
      loadPlans()
    } finally {
      setSaving(false)
    }
  }

  const handleDeletePlan = async (id: string) => {
    if (!window.confirm("删除该计划及其全部任务？")) return
    await plansApi.removePlan(id).catch(() => {})
    if (planFilter === id) setPlanFilter("all")
    loadPlans()
    loadMonth(monthKeyOf(cursor))
  }

  const handleNewTask = async () => {
    const t = taskTitle.trim()
    if (!t || !taskPlan || saving) return
    setSaving(true)
    try {
      await plansApi.createTask(taskPlan, { title: t, due_date: selected })
      setTaskTitle("")
      setShowNewTask(false)
      loadMonth(monthKeyOf(cursor))
      loadPlans()
    } finally {
      setSaving(false)
    }
  }

  const handleToggleTask = async (task: PlanTask) => {
    await plansApi.updateTask(task.id, { done: !task.done }).catch(() => {})
    loadMonth(monthKeyOf(cursor))
    loadPlans()
  }

  const handleDeleteTask = async (id: string) => {
    await plansApi.removeTask(id).catch(() => {})
    loadMonth(monthKeyOf(cursor))
    loadPlans()
  }

  const moveMonth = (delta: number) => {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1))
  }

  return (
    <AppShell maxWidth={1180}>
      <PageHeader title="学习计划" subtitle="日历视图管理每日任务，保持学习节奏">
        <Button variant="secondary" size="md" onClick={() => setShowNewTask((v) => !v)}>
          <Plus className="w-4 h-4" strokeWidth={2} />
          新建任务
        </Button>
        <Button variant="primary" size="md" onClick={() => setShowNewPlan((v) => !v)}>
          <Plus className="w-4 h-4" strokeWidth={2} />
          新建计划
        </Button>
      </PageHeader>

      {/* 新建计划 */}
      {showNewPlan && (
        <Card className="p-4 mb-5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-caption text-ink-soft mb-1.5">计划名称</label>
              <input
                type="text"
                value={planTitle}
                onChange={(e) => setPlanTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleNewPlan()
                }}
                placeholder="例如：期末复习计划"
                className="w-full h-10 px-3 rounded-[4px] bg-paper-2 border border-line text-body text-ink placeholder:text-ink-disabled focus:outline-none focus:border-sea"
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-caption text-ink-soft mb-1.5">目标（可选）</label>
              <input
                type="text"
                value={planGoal}
                onChange={(e) => setPlanGoal(e.target.value)}
                placeholder="目标描述"
                className="w-full h-10 px-3 rounded-[4px] bg-paper-2 border border-line text-body text-ink placeholder:text-ink-disabled focus:outline-none focus:border-sea"
              />
            </div>
            <Button variant="primary" size="sm" onClick={handleNewPlan} disabled={saving}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
        </Card>
      )}

      {/* 计划 chips */}
      <div className="flex items-center gap-2 mb-5 overflow-x-auto scroll-thin">
        <Chip variant={planFilter === "all" ? "selected" : "filter"} onClick={() => setPlanFilter("all")}>
          全部
        </Chip>
        {plans.map((p) => (
          <div key={p.id} className="flex items-center gap-1 shrink-0">
            <Chip
              variant={planFilter === p.id ? "selected" : "filter"}
              onClick={() => setPlanFilter(p.id)}
            >
              {p.title} · {p.done_count}/{p.task_count}
            </Chip>
            <button
              onClick={() => handleDeletePlan(p.id)}
              aria-label={`删除计划 ${p.title}`}
              className="text-ink-disabled hover:text-danger transition-colors p-0.5"
            >
              <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 月历 */}
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => moveMonth(-1)}
              aria-label="上个月"
              className="p-1.5 rounded-[4px] text-ink-soft hover:bg-paper-2 hover:text-ink transition-colors"
            >
              <ChevronLeft className="w-5 h-5" strokeWidth={2} />
            </button>
            <div className="font-display text-title-s text-ink">
              {cursor.getFullYear()} 年 {cursor.getMonth() + 1} 月
            </div>
            <button
              onClick={() => moveMonth(1)}
              aria-label="下个月"
              className="p-1.5 rounded-[4px] text-ink-soft hover:bg-paper-2 hover:text-ink transition-colors"
            >
              <ChevronRight className="w-5 h-5" strokeWidth={2} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-2">
            {WEEK_LABELS.map((w) => (
              <div key={w} className="text-center text-caption text-ink-tertiary py-1">
                {w}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((d, i) => {
              if (!d) return <div key={`blank-${i}`} />
              const key = dateKey(d)
              const isToday = key === todayKey()
              const isSelected = key === selected
              const count = (tasksByDate[key] ?? []).length
              const doneCount = (tasksByDate[key] ?? []).filter((t) => t.done).length
              return (
                <button
                  key={key}
                  onClick={() => setSelected(key)}
                  className={cn(
                    "relative h-11 rounded-[4px] text-body transition-colors",
                    isSelected
                      ? "bg-sea-subtle text-ink font-medium ring-1 ring-sea/40"
                      : "hover:bg-paper-2 text-ink-soft",
                    isToday && !isSelected && "ring-1 ring-sea/50"
                  )}
                >
                  <span className={cn(isToday && "text-sea font-semibold")}>{d.getDate()}</span>
                  {count > 0 && (
                    <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex items-center gap-0.5">
                      <span className={cn("w-1.5 h-1.5 rounded-full", doneCount === count ? "bg-sea" : "bg-sea/50")} />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </Card>

        {/* 选中日期任务 */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-title-s text-ink">
              {selected.replaceAll("-", "/")}
            </h3>
            <div className="text-caption text-ink-tertiary">
              {selectedDone}/{selectedCount} 完成
            </div>
          </div>

          {showNewTask && (
            <div className="mb-3 space-y-2">
              <select
                value={taskPlan}
                onChange={(e) => setTaskPlan(e.target.value)}
                className="w-full h-10 px-3 rounded-[4px] bg-paper-2 border border-line text-body text-ink focus:outline-none focus:border-sea"
              >
                <option value="">选择计划…</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleNewTask()
                }}
                placeholder="任务内容，回车保存"
                className="w-full h-10 px-3 rounded-[4px] bg-paper-2 border border-line text-body text-ink placeholder:text-ink-disabled focus:outline-none focus:border-sea"
              />
            </div>
          )}

          <div className="max-h-[380px] overflow-y-auto scroll-thin">
            {filteredTasks.length === 0 ? (
              <div className="py-10 text-center">
                <EmptyState
                  icon={CalendarDays}
                  title="这一天没有任务"
                  description="点击「新建任务」安排这一天吧。"
                  size="md"
                />
              </div>
            ) : (
              <ul className="space-y-2">
                {filteredTasks.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center gap-2.5 p-2.5 rounded-[4px] bg-paper-2 border border-line-light"
                  >
                    <button
                      onClick={() => handleToggleTask(t)}
                      aria-label={t.done ? "标记为未完成" : "标记为完成"}
                      className={cn(
                        "w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors",
                        t.done
                          ? "bg-sea border-sea text-white"
                          : "border-line text-transparent hover:border-sea"
                      )}
                    >
                      <CheckCircle2 className="w-4 h-4" strokeWidth={2.5} />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div
                        className={cn(
                          "text-body truncate",
                          t.done ? "text-ink-disabled line-through" : "text-ink"
                        )}
                      >
                        {t.title}
                      </div>
                      {t.done && t.completed_at && (
                        <div className="text-caption text-ink-tertiary">
                          完成于 {new Date(t.completed_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleDeleteTask(t.id)}
                      aria-label="删除任务"
                      className="text-ink-disabled hover:text-danger transition-colors p-1 shrink-0"
                    >
                      <Trash2 className="w-4 h-4" strokeWidth={2} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </AppShell>
  )
}
