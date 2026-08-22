import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Clock, Flame } from "lucide-react"
import { useUI } from "@/context/UIContext"
import { analyticsApi, tasksApi } from "@/lib/api"
import { TodayTaskCard } from "@/components/blocks/TodayTaskCard"
import { DayCompleteCard, TaskRefillHint } from "@/components/blocks/DayCompleteCard"
import { EmptyNotes, MistRings } from "@/components/decor/PaperMotifs"
import { TASKS_EVENT } from "@/lib/taskNotify"
import type { ActivityStats, StreakStats, TodayTasksResult } from "@/types"
import { RailOverlay } from "./RailOverlay"

function formatDuration(seconds: number): string {
  if (seconds < 60) return "<1 分钟"
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m} 分钟`
  const h = Math.floor(m / 60)
  const mm = m % 60
  return mm ? `${h} 小时 ${mm} 分` : `${h} 小时`
}

export function StatusRail() {
  const navigate = useNavigate()
  const { rightPanelOpen, setRightPanelOpen, hasCustomRightPanel } = useUI()
  const [activity, setActivity] = useState<ActivityStats | null>(null)
  const [streak, setStreak] = useState<StreakStats | null>(null)
  const [today, setToday] = useState<TodayTasksResult | null>(null)

  useEffect(() => {
    if (!rightPanelOpen || hasCustomRightPanel) return
    analyticsApi.getActivity().then(setActivity).catch(() => {})
    analyticsApi.getStreak().then(setStreak).catch(() => {})
    tasksApi.getToday().then(setToday).catch(() => {})
  }, [rightPanelOpen, hasCustomRightPanel])

  useEffect(() => {
    const onTasks = (ev: Event) => {
      const res = (ev as CustomEvent<TodayTasksResult>).detail
      if (res?.tasks) setToday(res)
    }
    window.addEventListener(TASKS_EVENT, onTasks)
    return () => window.removeEventListener(TASKS_EVENT, onTasks)
  }, [])

  if (hasCustomRightPanel) return null

  const learn = activity ? formatDuration(activity.today_active_seconds) : "—"
  const quiz =
    activity && activity.today_quiz_seconds > 0
      ? ` · 刷题 ${formatDuration(activity.today_quiz_seconds)}`
      : ""
  const tasks = today?.tasks || []
  const pending = tasks.filter((t) => t.status === "pending").length

  return (
    <RailOverlay
      open={rightPanelOpen}
      title="今日状态"
      onClose={() => setRightPanelOpen(false)}
    >
      <section className="relative overflow-hidden rounded-2xl border border-line bg-paper mb-7 p-4">
        <div className="paper-grain pointer-events-none absolute inset-0 opacity-40" />
        <MistRings className="pointer-events-none absolute -right-8 -top-8 w-28 h-28 text-sea opacity-50" />
        <h3 className="relative text-caption font-semibold tracking-wide text-ink-disabled uppercase mb-3">
          学习时间
        </h3>
        <div className="relative space-y-3">
          <StatRow icon={Clock} label="今日学习" value={learn + quiz} />
          <StatRow icon={Flame} label="连续打卡" value={streak ? `${streak.current_streak} 天` : "—"} />
          <div className="pt-1">
            <div className="flex items-center justify-between text-caption mb-1.5">
              <span className="text-ink-soft">今日进度</span>
              <span className="font-semibold text-ink">
                {tasks.length ? `${tasks.length - pending}/${tasks.length}` : "—"}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-paper-2 overflow-hidden">
              <div
                className="h-full rounded-full bg-sea transition-all duration-500"
                style={{
                  width: tasks.length
                    ? `${Math.round(((tasks.length - pending) / tasks.length) * 100)}%`
                    : "0%",
                }}
              />
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-end justify-between mb-3">
          <h3 className="text-caption font-semibold tracking-wide text-ink-disabled uppercase">
            今日任务
          </h3>
          <button
            type="button"
            className="text-[11px] text-sea hover:underline"
            onClick={() => {
              setRightPanelOpen(false)
              navigate("/tasks")
            }}
          >
            全部
          </button>
        </div>
        {today?.day_complete ? (
          <div className="mb-2">
            <DayCompleteCard compact />
          </div>
        ) : null}
        {today?.refill_pending ? (
          <div className="mb-2">
            <TaskRefillHint compact />
          </div>
        ) : null}
        {tasks.length === 0 && !today?.day_complete && !today?.refill_pending ? (
          <div className="py-6 text-center">
            <EmptyNotes className="mx-auto mb-2 w-24 h-14" />
            <p className="text-caption text-ink-disabled">今天还没有任务</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tasks.map((task, i) => (
              <TodayTaskCard
                key={task.id}
                task={task}
                index={i}
                compact
                onGo={() => {
                  setRightPanelOpen(false)
                  navigate(task.href || "/quiz")
                }}
              />
            ))}
          </div>
        )}
      </section>
    </RailOverlay>
  )
}

function StatRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock
  label: string
  value: string
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="inline-flex items-center gap-2 text-caption text-ink-soft">
        <Icon className="w-3.5 h-3.5 text-sea" strokeWidth={2} />
        {label}
      </span>
      <span className="text-body font-semibold text-ink">{value}</span>
    </div>
  )
}
