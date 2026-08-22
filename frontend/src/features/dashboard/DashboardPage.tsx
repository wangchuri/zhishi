import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { MessageSquare, Library, BarChart3, Pencil } from "lucide-react"
import { AppShell } from "@/components/layout/AppShell"
import { SectionHeader } from "@/components/blocks/SectionHeader"
import { QuickActionCard } from "@/components/blocks/QuickActionCard"
import { TaskSpine, TodayTaskCard } from "@/components/blocks/TodayTaskCard"
import { EmptyNotes, MistRings, SageSprig, SealMark, TimeMotif } from "@/components/decor/PaperMotifs"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/context/AuthContext"
import { tasksApi, profileApi } from "@/lib/api"
import { noticeTodayTasks, TASKS_EVENT } from "@/lib/taskNotify"
import { DayCompleteCard, TaskRefillHint } from "@/components/blocks/DayCompleteCard"
import type { TodayTasksResult } from "@/types"

const quickActions = [
  { id: "quiz", title: "资料", description: "阅读、出题、刷题都在这里", to: "/quiz" },
  { id: "progress", title: "进度", description: "薄弱点和成就", to: "/analytics" },
  { id: "chat", title: "Tina", description: "向 Tina 提问、检索资料", to: "/chat" },
]

const quickActionIcons = [Library, BarChart3, MessageSquare]

function getTimeGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 6) return "深夜好"
  if (hour < 9) return "早上好"
  if (hour < 12) return "上午好"
  if (hour < 14) return "中午好"
  if (hour < 18) return "下午好"
  return "晚上好"
}

export function DashboardPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [greetingName, setGreetingName] = useState(user?.nickname || "")
  const [today, setToday] = useState<TodayTasksResult | null>(null)
  const [goalDraft, setGoalDraft] = useState("")
  const [savingGoal, setSavingGoal] = useState(false)
  const [checkingGoal, setCheckingGoal] = useState(true)
  const [tasksLoading, setTasksLoading] = useState(false)
  const [editingGoal, setEditingGoal] = useState(false)

  useEffect(() => {
    let cancelled = false
    profileApi
      .get()
      .then((profile) => {
        if (cancelled) return
        if (!profile.has_goal && profile.onboarding_status !== "completed") {
          navigate("/onboarding", { replace: true })
          return
        }
        if (profile.nickname) setGreetingName(profile.nickname)
        if (profile.goal?.text) setGoalDraft(profile.goal.text)
        setCheckingGoal(false)
        setTasksLoading(true)
        return tasksApi.ensureToday()
      })
      .then((res) => {
        if (cancelled || !res) return
        setToday(res)
        if (res.goal?.text) setGoalDraft(res.goal.text)
        noticeTodayTasks(res)
      })
      .catch(() => {
        if (!cancelled) setCheckingGoal(false)
      })
      .finally(() => {
        if (!cancelled) setTasksLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [navigate])

  useEffect(() => {
    const onTasks = (ev: Event) => {
      const res = (ev as CustomEvent<TodayTasksResult>).detail
      if (!res?.tasks) return
      setToday((prev) => ({ ...(prev || res), ...res }))
      if (res.goal?.text) setGoalDraft(res.goal.text)
    }
    window.addEventListener(TASKS_EVENT, onTasks)
    return () => window.removeEventListener(TASKS_EVENT, onTasks)
  }, [])

  const saveGoal = async () => {
    const text = goalDraft.trim()
    if (!text || savingGoal) return
    setSavingGoal(true)
    try {
      await tasksApi.putGoal({ text })
      const res = await tasksApi.ensureToday()
      setToday(res)
      setEditingGoal(false)
    } finally {
      setSavingGoal(false)
    }
  }

  useEffect(() => {
    if (user?.nickname) setGreetingName(user.nickname)
  }, [user])

  if (checkingGoal) {
    return (
      <AppShell maxWidth={880}>
        <div className="relative py-24 text-center overflow-hidden">
          <MistRings className="animate-mist mx-auto mb-4 w-24 h-24 text-sea" />
          <p className="font-display text-title-s text-ink mb-1">正在打开</p>
          <p className="text-caption text-ink-disabled">纸页摊开，稍等一下</p>
        </div>
      </AppShell>
    )
  }

  const goalText = today?.goal?.text || goalDraft.trim()
  const pendingCount = (today?.tasks || []).filter((t) => t.status === "pending").length

  return (
    <AppShell maxWidth={880}>
      <section className="relative overflow-hidden rounded-3xl border border-line bg-paper mb-8 short:mb-5 px-6 py-7 md:px-8 md:py-8 shadow-[0_8px_28px_-16px_rgba(20,33,43,0.12)]">
        <div className="paper-grain pointer-events-none absolute inset-0 opacity-50" />
        <MistRings className="animate-mist pointer-events-none absolute -right-10 -top-12 w-56 h-56 text-sea" />
        <SageSprig className="animate-sprig pointer-events-none absolute right-10 -bottom-4 w-[4.5rem] h-32 text-sea hidden sm:block" />
        <div className="relative flex items-start gap-4">
          <TimeMotif hour={new Date().getHours()} className="hidden sm:block w-14 h-12 text-sea shrink-0 mt-1" />
          <div className="min-w-0">
            <h1 className="font-display text-[2rem] md:text-[2.35rem] leading-tight text-ink mb-2">
              {getTimeGreeting()}，{greetingName || "朋友"}
            </h1>
            <p className="text-body text-ink-soft max-w-xl">
              不知道该做什么的时候，不妨{" "}
              <button
                type="button"
                className="text-sea hover:underline"
                onClick={() =>
                  navigate(
                    today?.onboarding_session_id
                      ? `/chat?session=${encodeURIComponent(today.onboarding_session_id)}`
                      : "/chat",
                  )
                }
              >
                和 Tina 聊聊
              </button>
            </p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8 short:mb-5">
        {quickActions.map((action, i) => (
          <QuickActionCard
            key={action.id}
            icon={quickActionIcons[i]}
            title={action.title}
            description={action.description}
            onClick={() => navigate(action.to)}
            className="relative overflow-hidden rounded-2xl"
          />
        ))}
      </div>

      <section className="mb-8 short:mb-5">
        {goalText && !editingGoal ? (
          <div className="relative overflow-hidden rounded-2xl border border-line bg-paper p-5 md:p-6 shadow-[0_4px_20px_-2px_rgba(20,33,43,0.05)] border-l-[3px] border-l-sea">
            <div className="paper-grain pointer-events-none absolute inset-0 opacity-40" />
            <SealMark className="pointer-events-none absolute -right-3 -bottom-4 w-24 h-24 text-sea/15" />
            <div className="relative flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold tracking-wide text-sea mb-2">我的目标</p>
                <p className="text-title-s md:text-lg font-semibold leading-relaxed text-ink">{goalText}</p>
                <p className="text-[11px] text-ink-disabled mt-2">任务都围着这个走</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingGoal(true)}
                className="shrink-0 h-8 px-3 rounded-full border border-line bg-paper-2 text-caption text-ink-soft hover:text-sea hover:border-sea/40 inline-flex items-center gap-1.5 transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" strokeWidth={2} />
                修改
              </button>
            </div>
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-2xl border border-line bg-paper p-5">
            <SageSprig className="pointer-events-none absolute right-3 bottom-0 w-12 h-20 text-sea/25" />
            <p className="relative text-[11px] font-semibold tracking-wide text-sea mb-3">写下这段时间要学什么</p>
            <div className="relative flex gap-2">
              <input
                type="text"
                value={goalDraft}
                onChange={(e) => setGoalDraft(e.target.value)}
                placeholder="一句话写下你这段时间要学什么"
                className="flex-1 h-11 px-3 rounded-xl bg-paper-2 border border-line text-body text-ink placeholder:text-ink-disabled focus:outline-none focus:border-sea"
              />
              <Button onClick={() => void saveGoal()} disabled={savingGoal || !goalDraft.trim()}>
                {today?.goal ? "更新" : "保存"}
              </Button>
              {goalText ? (
                <Button variant="ghost" onClick={() => setEditingGoal(false)}>
                  取消
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </section>

      <section className="mb-4">
        <SectionHeader title="Tina 给你的任务" subtitle="根据上面的目标排的，完成由程序判定">
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-ink-disabled">
              {tasksLoading ? "正在安排…" : `今天 ${today?.tasks?.length || 0} 件`}
              {pendingCount > 0 ? ` · 待完成 ${pendingCount}` : ""}
            </span>
            <button
              type="button"
              className="text-[11px] text-sea hover:underline"
              onClick={() => navigate("/tasks")}
            >
              全部任务
            </button>
          </div>
        </SectionHeader>
        {!today?.tasks?.length && !today?.refill_pending && !today?.day_complete ? (
          <div className="relative overflow-hidden rounded-2xl border border-dashed border-line bg-paper/70 px-5 py-10 text-center">
            <EmptyNotes className="mx-auto mb-3 w-28 h-16" />
            <p className="text-body text-ink-soft">
              {tasksLoading ? "正在把今天的便签写好…" : "今天的便签还是空白，保存目标或刷新后再看。"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {today?.day_complete ? <DayCompleteCard /> : null}
            {today?.refill_pending ? <TaskRefillHint /> : null}
            {today?.tasks?.length ? (
              <TaskSpine>
                {today.tasks.map((task, i) => (
                  <TodayTaskCard
                    key={task.id}
                    task={task}
                    index={i}
                    onGo={() => navigate(task.href || "/quiz")}
                  />
                ))}
              </TaskSpine>
            ) : null}
          </div>
        )}
      </section>
    </AppShell>
  )
}
