import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { MessageSquare, Library, BarChart3, Pencil } from "lucide-react"
import { AppShell } from "@/components/layout/AppShell"
import { SectionHeader } from "@/components/blocks/SectionHeader"
import { QuickActionCard } from "@/components/blocks/QuickActionCard"
import { DayCompleteCard, TaskRefillHint, TodayTaskSection } from "@/components/blocks/DayCompleteCard"
import { TaskAgentWriting } from "@/components/blocks/TaskAgentWriting"
import { EmptyNotes, MistRings, SageSprig, SealMark, TimeMotif } from "@/components/decor/PaperMotifs"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/context/AuthContext"
import { tasksApi, profileApi } from "@/lib/api"
import { noticeTodayTasks, TASKS_EVENT } from "@/lib/taskNotify"
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
          <div className="relative overflow-hidden rounded-3xl border border-sea/25 bg-gradient-to-br from-sea-subtle via-paper to-paper px-5 py-6 md:px-7 md:py-7 shadow-[0_10px_32px_-18px_rgba(31,92,90,0.35)]">
            <div className="paper-grain pointer-events-none absolute inset-0 opacity-35" />
            <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-sea/40 to-transparent md:inset-x-7" />
            <MistRings className="pointer-events-none absolute -right-16 -top-16 w-48 h-48 text-sea opacity-30" />
            <SealMark className="pointer-events-none absolute right-4 bottom-3 w-16 h-16 text-sea/20 md:right-6" label="向" />

            <div className="relative flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="mb-3 inline-flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-sea" />
                  <span className="text-[11px] font-semibold tracking-[0.14em] uppercase text-sea">
                    我的目标
                  </span>
                </div>
                <p className="font-display text-[1.45rem] md:text-[1.75rem] leading-snug text-ink max-w-2xl">
                  {goalText}
                </p>
                <p className="mt-3 text-caption text-ink-soft">
                  今天的任务都围着这个方向走
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setGoalDraft(goalText)
                  setEditingGoal(true)
                }}
                className="shrink-0 h-9 px-3.5 rounded-full border border-sea/25 bg-paper/80 text-caption text-sea hover:bg-paper hover:border-sea/45 inline-flex items-center gap-1.5 transition-colors backdrop-blur-sm"
              >
                <Pencil className="w-3.5 h-3.5" strokeWidth={2} />
                修改
              </button>
            </div>
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-3xl border border-dashed border-sea/35 bg-sea-subtle/50 px-5 py-6 md:px-7">
            <SageSprig className="pointer-events-none absolute right-3 bottom-0 w-12 h-20 text-sea/30" />
            <p className="relative mb-1 text-[11px] font-semibold tracking-[0.14em] uppercase text-sea">
              写下这段时间要学什么
            </p>
            <p className="relative mb-4 text-caption text-ink-soft">
              一句话就好，后面的任务都会围着它排
            </p>
            <div className="relative flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={goalDraft}
                onChange={(e) => setGoalDraft(e.target.value)}
                placeholder="例如：备考 408，先把四门课过一轮"
                className="flex-1 h-11 px-3.5 rounded-xl bg-paper border border-sea/20 text-body text-ink placeholder:text-ink-disabled focus:outline-none focus:border-sea"
              />
              <div className="flex gap-2 shrink-0">
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
          tasksLoading ? (
            <TaskAgentWriting />
          ) : (
            <div className="relative overflow-hidden rounded-2xl border border-dashed border-line bg-paper/70 px-5 py-10 text-center">
              <EmptyNotes className="mx-auto mb-3 w-28 h-16" />
              <p className="text-body text-ink-soft">今天的便签还是空白，保存目标或刷新后再看。</p>
            </div>
          )
        ) : (
          <TodayTaskSection
            tasks={today?.tasks || []}
            dayComplete={today?.day_complete}
            onGo={(task) => navigate(task.href || "/quiz")}
          >
            {today?.day_complete ? <DayCompleteCard /> : null}
            {today?.refill_pending ? <TaskRefillHint /> : null}
          </TodayTaskSection>
        )}
      </section>
    </AppShell>
  )
}
