import { useState } from "react"
import {
  Bell,
  RotateCcw,
  FileText,
  CheckCircle2,
  Calendar,
  Clock,
  Plus,
} from "lucide-react"
import { AppShell } from "@/components/layout/AppShell"
import { RightPanel } from "@/components/layout/RightPanel"
import { PageHeader } from "@/components/blocks/PageHeader"
import { StatCard } from "@/components/ui/stat-card"
import { EmptyState } from "@/components/ui/empty-state"
import { Chip } from "@/components/ui/chip"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Reminder } from "@/types"

const typeConfig: Record<Reminder["type"], { label: string; icon: typeof Bell; tone: "primary" | "info" | "warning" | "neutral" }> = {
  review: { label: "复习", icon: RotateCcw, tone: "primary" },
  task: { label: "任务", icon: CheckCircle2, tone: "info" },
  doc: { label: "文档", icon: FileText, tone: "warning" },
  longterm: { label: "长期", icon: Calendar, tone: "neutral" },
}

const filters = [
  { label: "今天", value: "today" },
  { label: "本周", value: "week" },
  { label: "全部", value: "all" },
  { label: "已完成", value: "done" },
]

export function RemindersPage() {
  const [filter, setFilter] = useState("all")

  return (
    <AppShell maxWidth={1180}>
      <PageHeader title="智能提醒" subtitle="Tina 会帮你安排复习和任务提醒">
        <Button variant="primary" size="md">
          <Plus className="w-4 h-4" strokeWidth={2} />
          创建提醒
        </Button>
      </PageHeader>

      {/* 统计 */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard icon={Clock} label="待处理" value={0} tone="warning" />
        <StatCard icon={Calendar} label="今天" value={0} tone="primary" />
        <StatCard icon={CheckCircle2} label="已完成" value={0} tone="success" />
      </div>

      {/* 筛选 */}
      <div className="flex items-center gap-2 mb-5">
        {filters.map((f) => (
          <Chip key={f.value} variant={filter === f.value ? "selected" : "filter"} onClick={() => setFilter(f.value)}>
            {f.label}
          </Chip>
        ))}
      </div>

      {/* 列表 */}
      <div className="bg-surface border border-line-soft rounded-lg shadow-xs">
        <EmptyState
          icon={Bell}
          title="暂无提醒"
          description="你可以为复习、作业、文档整理设置提醒。"
          primaryAction={{ label: "创建提醒" }}
          size="lg"
        />
      </div>

      {/* 右侧创建面板 */}
      <RightPanel title="创建提醒">
        <div className="space-y-4">
          <Field label="提醒标题">
            <Input placeholder="例如：复习 State 管理笔记" />
          </Field>

          <Field label="提醒类型">
            <div className="flex flex-wrap gap-1.5">
              {(Object.entries(typeConfig) as [Reminder["type"], typeof typeConfig[Reminder["type"]]][]).map(([type, cfg]) => (
                <Chip key={type} variant="default" size="sm">
                  <cfg.icon className="w-3 h-3" strokeWidth={2} />
                  {cfg.label}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="提醒时间">
            <Input type="datetime-local" />
          </Field>

          <Field label="是否重复">
            <div className="flex gap-2">
              <Chip variant="selected" size="md">不重复</Chip>
              <Chip variant="default" size="md">每天</Chip>
              <Chip variant="default" size="md">每周</Chip>
            </div>
          </Field>

          <Field label="关联笔记 / 文档">
            <Input placeholder="搜索关联内容..." />
          </Field>

          <Button variant="primary" size="md" className="w-full mt-2">
            <Plus className="w-4 h-4" strokeWidth={2} />
            创建提醒
          </Button>
        </div>
      </RightPanel>
    </AppShell>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-small text-ink-secondary mb-1.5 font-medium">{label}</label>
      {children}
    </div>
  )
}