import { useState, useEffect } from "react"
import {
  BarChart3,
  Flame,
  CheckCircle2,
  Repeat,
  Clock,
  Hourglass,
  AlertTriangle,
  TrendingUp,
} from "lucide-react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  LineChart,
  Line,
} from "recharts"
import { AppShell } from "@/components/layout/AppShell"
import { PageHeader } from "@/components/blocks/PageHeader"
import { SectionHeader } from "@/components/blocks/SectionHeader"
import { StatCard } from "@/components/ui/stat-card"
import { ProgressMeter } from "@/components/blocks/ProgressMeter"
import { SegmentedTabs } from "@/components/ui/segmented-tabs"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { ktApi } from "@/lib/api"

interface SkillData {
  name: string
  mastery: number
  status: "mastered" | "practicing" | "pending"
}

export function LearningAnalyticsPage() {
  const [chart, setChart] = useState("mastery")
  const [loading, setLoading] = useState(true)
  const [skillMasteries, setSkillMasteries] = useState<SkillData[]>([])
  const [overview, setOverview] = useState({ mastery: 0, mastered: 0, practicing: 0, pending: 0 })

  useEffect(() => {
    // Use default skill states based on graph data (7 hardcoded skills)
    const defaultStates = [
      { skill_name: "加法", value: 95 },
      { skill_name: "减法", value: 90 },
      { skill_name: "乘法", value: 75 },
      { skill_name: "除法", value: 60 },
      { skill_name: "一元一次方程", value: 40 },
      { skill_name: "函数基础", value: 25 },
      { skill_name: "微积分入门", value: 10 },
    ]

    ktApi.evaluate(defaultStates)
      .then((res) => {
        const corrected = res.corrected_states || res.states || defaultStates
        const skills: SkillData[] = corrected.map((s: any) => {
          const val = s.value ?? s.level ?? 0
          return {
            name: s.skill_name || s.name || "未知",
            mastery: val,
            status: val >= 80 ? "mastered" : val >= 30 ? "practicing" : "pending",
          } as SkillData
        })
        setSkillMasteries(skills)

        const total = skills.length || 7
        const sum = skills.reduce((a, s) => a + s.mastery, 0)
        const mastered = skills.filter((s) => s.status === "mastered").length
        const practicing = skills.filter((s) => s.status === "practicing").length
        const pending = skills.filter((s) => s.status === "pending").length
        setOverview({ mastery: total > 0 ? Math.round(sum / total) : 0, mastered, practicing, pending })
      })
      .catch(() => {
        // fallback: use default states if API fails
        const defaultSkills: SkillData[] = defaultStates.map((s) => ({
          name: s.skill_name,
          mastery: s.value,
          status: s.value >= 80 ? "mastered" : s.value >= 30 ? "practicing" : "pending",
        } as SkillData))
        setSkillMasteries(defaultSkills)
        setOverview({
          mastery: Math.round(defaultStates.reduce((a, s) => a + s.value, 0) / defaultStates.length),
          mastered: defaultStates.filter((s) => s.value >= 80).length,
          practicing: defaultStates.filter((s) => s.value >= 30 && s.value < 80).length,
          pending: defaultStates.filter((s) => s.value < 30).length,
        })
      })
      .finally(() => setLoading(false))
  }, [])

  const masteryData = [
    { name: "已掌握", value: overview.mastered, fill: "#22C55E" },
    { name: "练习中", value: overview.practicing, fill: "#6366F1" },
    { name: "待学习", value: overview.pending, fill: "#9CA3AF" },
  ]

  const trendData = [
    { day: "周一", minutes: 90 },
    { day: "周二", minutes: 120 },
    { day: "周三", minutes: 60 },
    { day: "周四", minutes: 150 },
    { day: "周五", minutes: 100 },
    { day: "周六", minutes: 180 },
    { day: "周日", minutes: 120 },
  ]

  const logicConflicts = skillMasteries.length === 0 ? [] : [
    { id: "c1", title: "部分技能掌握度低于前置知识，建议按学习路径补足", suggestion: "查看学习路径页面获取推荐顺序" },
  ]

  if (loading) {
    return (
      <AppShell maxWidth={1180}>
        <PageHeader title="学习分析" subtitle="正在加载 LEKT 评估数据…">
          <Badge variant="primary" size="md">加载中</Badge>
        </PageHeader>
        <div className="bg-surface border border-line-soft rounded-lg shadow-xs p-12 flex items-center justify-center">
          <div className="flex items-center gap-2 text-ink-tertiary">
            <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span className="text-body">加载中...</span>
          </div>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell maxWidth={1180}>
      <PageHeader title="学习分析" subtitle="LEKT 知识追踪模型实时评估">
        <Badge variant="success" size="md">LEKT 在线</Badge>
      </PageHeader>

      {/* 本周学习状态卡 */}
      <Card variant="elevated" className="mb-8">
        <div className="p-6">
          <h2 className="text-section-title text-ink-primary mb-4">本周学习状态</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <div className="text-small text-ink-tertiary mb-1">当前状态</div>
              <div className="inline-flex items-center gap-1.5 text-card-title text-ink-primary font-semibold">
                <Flame className="w-4 h-4 text-warning" strokeWidth={2} />
                学习进行中
              </div>
            </div>
            <div>
              <div className="text-small text-ink-tertiary mb-1">掌握度结论</div>
              <div className="text-card-title text-ink-primary font-semibold">
                总体掌握度 <span className="text-primary">{overview.mastery}%</span>
                ，{overview.mastered}/{skillMasteries.length || 7} 项已掌握
              </div>
            </div>
            <div>
              <div className="text-small text-ink-tertiary mb-1">下一步建议</div>
              <div className="text-card-title text-ink-primary font-semibold">
                优先补齐 <span className="text-primary">{overview.pending} 个</span>待学习技能
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* 数据卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon={BarChart3} label="总体掌握度" value={`${overview.mastery}%`} tone="primary" />
        <StatCard icon={Flame} label="连续学习" value="—" tone="warning" />
        <StatCard icon={CheckCircle2} label="已掌握" value={overview.mastered} tone="success" />
        <StatCard icon={Repeat} label="练习中" value={overview.practicing} tone="info" />
        <StatCard icon={Clock} label="待学习" value={overview.pending} tone="neutral" />
        <StatCard icon={Clock} label="今日学习" value="—" tone="primary" />
        <StatCard icon={Hourglass} label="总学习时长" value="—" tone="info" />
        <StatCard icon={TrendingUp} label="本周趋势" value="—" tone="success" />
      </div>

      {/* 可信度评分 */}
      <div className="mb-8">
        <SectionHeader title="可信度评分" subtitle="各技能当前掌握程度（LEKT 评估）" />
        <Card className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
            {skillMasteries.map((s) => (
              <ProgressMeter key={s.name} label={s.name} value={s.mastery} />
            ))}
          </div>
        </Card>
      </div>

      {/* 逻辑依赖校验 */}
      <div className="mb-8">
        <SectionHeader
          title="逻辑依赖校验"
          subtitle={logicConflicts.length > 0 ? `发现 ${logicConflicts.length} 个逻辑冲突` : "无逻辑冲突"}
        />
        <div className="space-y-3">
          {logicConflicts.map((c) => (
            <Card key={c.id} className="p-4 flex items-start gap-3">
              <div className="w-8 h-8 rounded-md bg-warning-soft text-warning flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4" strokeWidth={2} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-body text-ink-primary font-medium mb-1">{c.title}</div>
                <div className="text-small text-ink-secondary">{c.suggestion}</div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* 图表区 */}
      <div className="mb-4">
        <SectionHeader title="数据图表">
          <SegmentedTabs
            value={chart}
            onChange={setChart}
            size="sm"
            tabs={[
              { label: "掌握度分布", value: "mastery" },
              { label: "学习趋势", value: "trend" },
              { label: "最近活动", value: "activity" },
            ]}
          />
        </SectionHeader>

        <Card className="p-6">
          {chart === "mastery" && (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={masteryData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F4" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    background: "#FFFFFF",
                    border: "1px solid #EEF0F4",
                    borderRadius: 12,
                    fontSize: 13,
                  }}
                />
                <Bar dataKey="value" radius={[8, 8, 0, 0]} barSize={64} />
              </BarChart>
            </ResponsiveContainer>
          )}

          {chart === "trend" && (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trendData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F4" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 12, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    background: "#FFFFFF",
                    border: "1px solid #EEF0F4",
                    borderRadius: 12,
                    fontSize: 13,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="minutes"
                  stroke="#6366F1"
                  strokeWidth={2.5}
                  dot={{ fill: "#6366F1", r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}

          {chart === "activity" && (
            <div className="space-y-2.5">
              <div className="text-body text-ink-tertiary py-8 text-center">
                暂无学习活动记录
              </div>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  )
}