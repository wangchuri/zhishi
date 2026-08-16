import { useState, useEffect, useCallback } from "react"
import {
  Bell,
  CheckCircle2,
  Calendar,
  Clock,
  Plus,
  Trash2,
  AlertTriangle,
} from "lucide-react"
import { AppShell } from "@/components/layout/AppShell"
import { PageHeader } from "@/components/blocks/PageHeader"
import { StatCard } from "@/components/ui/stat-card"
import { EmptyState } from "@/components/ui/empty-state"
import { Chip } from "@/components/ui/chip"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { remindersApi } from "@/lib/api"
import type { ReminderList } from "@/types"

const filters = [
  { label: "今天", value: "today" },
  { label: "本周", value: "week" },
  { label: "全部", value: "all" },
  { label: "已完成", value: "done" },
]

function formatDate(value: string): string {
  const d = new Date(`${value}T00:00:00`)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", weekday: "short" })
}

function todayStr(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${mm}-${dd}`
}

export function RemindersPage() {
  const [filter, setFilter] = useState("all")
  const [data, setData] = useState<ReminderList | null>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState("")
  const [date, setDate] = useState(todayStr())
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    remindersApi
      .list(filter)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [filter])

  useEffect(() => {
    load()
  }, [load])

  const handleCreate = async () => {
    const t = title.trim()
    if (!t || saving) return
    setSaving(true)
    try {
      await remindersApi.create({ title: t, remind_date: date })
      setTitle("")
      setShowForm(false)
      load()
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (id: string, done: boolean) => {
    await remindersApi.update(id, { done }).catch(() => {})
    load()
  }

  const handleDelete = async (id: string) => {
    await remindersApi.remove(id).catch(() => {})
    load()
  }

  const reminders = data?.reminders ?? []
  const pendingCount = reminders.filter((r) => !r.done).length
  const todayCount = reminders.filter((r) => r.remind_date === todayStr() && !r.done).length
  const doneCount = reminders.filter((r) => r.done).length
  const autoCount = data?.auto_review.count ?? 0

  return (
    <AppShell maxWidth={1180}>
      <PageHeader title="智能提醒" subtitle="手动安排复习与任务，Tina 帮你盯紧错题" />

      {/* 统计 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard icon={Clock} label="待处理" value={pendingCount} tone="warning" />
        <StatCard icon={Calendar} label="今天" value={todayCount} tone="primary" />
        <StatCard icon={CheckCircle2} label="已完成" value={doneCount} tone="success" />
        <StatCard icon={AlertTriangle} label="待复习错题" value={autoCount} tone="warning" />
      </div>

      {/* 自动错题提醒 */}
      {autoCount > 0 && (
        <Card className="p-4 mb-6 border-danger/20 bg-danger/5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-[4px] bg-danger/10 text-danger flex items-center justify-center shrink-0">
              <AlertTriangle className="w-4 h-4" strokeWidth={2} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-body font-medium text-ink mb-1">
                有 {autoCount} 道错题待复习
              </h3>
              <p className="text-caption text-ink-soft">
                最近答错或不会的题目
                {data?.auto_review.document_names.length
                  ? ` · 来自：${data.auto_review.document_names.join("、")}`
                  : ""}
              </p>
              <a
                href="/quiz"
                onClick={(e) => {
                  e.preventDefault()
                  window.location.href = "/quiz"
                }}
                className="inline-block mt-2 text-caption text-danger hover:underline"
              >
                去复习 →
              </a>
            </div>
          </div>
        </Card>
      )}

      {/* 筛选 */}
      <div className="flex items-center justify-between gap-2 mb-5">
        <div className="flex items-center gap-2">
          {filters.map((f) => (
            <Chip
              key={f.value}
              variant={filter === f.value ? "selected" : "filter"}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </Chip>
          ))}
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowForm((v) => !v)}>
          <Plus className="w-4 h-4" strokeWidth={2} />
          新建提醒
        </Button>
      </div>

      {/* 新建表单 */}
      {showForm && (
        <Card className="p-4 mb-5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <label className="block text-caption text-ink-soft mb-1.5">提醒内容</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate()
                }}
                placeholder="例如：复习极限的定义"
                className="w-full h-10 px-3 rounded-[4px] bg-paper-2 border border-line text-body text-ink placeholder:text-ink-disabled focus:outline-none focus:border-sea"
              />
            </div>
            <div>
              <label className="block text-caption text-ink-soft mb-1.5">日期</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-10 px-3 rounded-[4px] bg-paper-2 border border-line text-body text-ink focus:outline-none focus:border-sea"
              />
            </div>
            <Button variant="primary" size="sm" onClick={handleCreate} disabled={saving}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
        </Card>
      )}

      {/* 列表 */}
      <div className="bg-surface border border-line-soft rounded-lg shadow-xs">
        {loading ? (
          <div className="py-12 text-center text-body text-ink-tertiary">加载中...</div>
        ) : reminders.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={filter === "done" ? "还没有已完成的提醒" : "暂无提醒"}
            description={
              filter === "done"
                ? "完成提醒后会出现在这里。"
                : "你可以为复习、作业、文档整理设置提醒。"
            }
            size="lg"
          />
        ) : (
          <ul className="divide-y divide-line-soft">
            {reminders.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                <button
                  onClick={() => handleToggle(r.id, !r.done)}
                  aria-label={r.done ? "标记为未完成" : "标记为完成"}
                  className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                    r.done
                      ? "bg-sea border-sea text-white"
                      : "border-line text-transparent hover:border-sea"
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4" strokeWidth={2.5} />
                </button>
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-body truncate ${r.done ? "text-ink-disabled line-through" : "text-ink"}`}
                  >
                    {r.title}
                  </div>
                  <div className="text-caption text-ink-tertiary">
                    {formatDate(r.remind_date)}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(r.id)}
                  aria-label="删除提醒"
                  className="text-ink-disabled hover:text-danger transition-colors p-1"
                >
                  <Trash2 className="w-4 h-4" strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  )
}
