import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import {
  Search,
  Sparkles,
  NotebookPen,
  MessageSquare,
  Upload,
  Network,
  FileText,
  Lightbulb,
  Clock,
  FileStack,
  ArrowRight,
} from "lucide-react"
import { AppShell } from "@/components/layout/AppShell"
import { RightPanel } from "@/components/layout/RightPanel"
import { SectionHeader } from "@/components/blocks/SectionHeader"
import { QuickActionCard } from "@/components/blocks/QuickActionCard"
import { RecommendCard } from "@/components/blocks/RecommendCard"
import { RecentList } from "@/components/blocks/RecentList"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/context/AuthContext"
import { chatApi, kbApi, dashboardApi } from "@/lib/api"

const quickActions = [
  { id: "note", title: "新建笔记", description: "记录想法、整理资料", to: "/notes" },
  { id: "chat", title: "AI 对话", description: "向 Tina 提问、整理文档", to: "/chat" },
  { id: "upload", title: "上传资料", description: "PDF、TXT、MD、DOCX", to: "/knowledge/upload" },
  { id: "graph", title: "知识图谱", description: "查看标签与知识关系", to: "/graph" },
]

const quickActionIcons = [NotebookPen, MessageSquare, Upload, Network]

const rightPanelShortcuts = [
  { label: "上传资料", to: "/knowledge/upload" },
  { label: "创建提醒", to: "/reminders" },
  { label: "查看学习路径", to: "/path" },
]

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
  const [recentItems, setRecentItems] = useState<Array<{ id: string; title: string; meta: string }>>([])
  const [suggestions, setSuggestions] = useState<string[]>(["上传文档，开启智能学习", "完善学习画像，获得精准推荐"])
  const [searchInput, setSearchInput] = useState("")

  const handleSearch = () => {
    const q = searchInput.trim()
    if (q) {
      navigate(`/chat?q=${encodeURIComponent(q)}`)
    }
  }

  useEffect(() => {
    Promise.allSettled([
      chatApi.getSessions(),
      kbApi.listDocuments(1, 5),
    ]).then(([sessionsResult, docsResult]) => {
      const items: Array<{ id: string; title: string; meta: string }> = []

      if (sessionsResult.status === "fulfilled") {
        const sessions = sessionsResult.value?.sessions || sessionsResult.value || []
        ;(Array.isArray(sessions) ? sessions.slice(0, 3) : []).forEach((s: any) => {
          items.push({
            id: `session-${s.session_id || s.id}`,
            title: s.title || s.last_message || "对话记录",
            meta: `对话 · ${s.updated_at || s.updatedAt || "最近"}`,
          })
        })
      }

      if (docsResult.status === "fulfilled") {
        const rawDocs = docsResult.value?.data || docsResult.value?.documents || []
        ;(Array.isArray(rawDocs) ? rawDocs.slice(0, 3) : []).forEach((d: any) => {
          items.push({
            id: `doc-${d.id}`,
            title: d.name || d.file_name || "文档",
            meta: `知识库 · ${d.updated_at || d.updatedAt || "最近"}`,
          })
        })
      }

      setRecentItems(items)
    })

    dashboardApi.getSuggestions()
      .then((res) => {
        if (res.suggestions?.length) {
          setSuggestions(res.suggestions)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (user?.nickname) setGreetingName(user.nickname)
  }, [user])

  return (
    <AppShell maxWidth={1180}>
      <div className="flex items-end justify-between gap-6 mb-6">
        <div className="min-w-0">
          <h1 className="text-page-title text-ink-primary mb-1.5">{getTimeGreeting()}，{greetingName || "朋友"}</h1>
          <p className="text-body text-ink-secondary">持续学习，成就更好的自己。</p>
        </div>
      </div>

      {/* AI 搜索框 */}
      <form
        onSubmit={(e) => { e.preventDefault(); handleSearch() }}
        className="relative group mb-10"
      >
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-ink-tertiary group-focus-within:text-primary transition-colors" strokeWidth={2} />
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="搜索笔记、文档、标签，或直接问 Tina..."
          className="w-full h-12 pl-12 pr-32 rounded-lg bg-surface border border-line-soft text-body text-ink-primary placeholder:text-ink-tertiary focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
        />
        <Button type="submit" variant="gradient" size="md" className="absolute right-2 top-1/2 -translate-y-1/2">
          <Sparkles className="w-4 h-4" strokeWidth={2} />
          AI 搜索
        </Button>
      </form>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        {quickActions.map((action, i) => (
          <QuickActionCard
            key={action.id}
            icon={quickActionIcons[i]}
            title={action.title}
            description={action.description}
            onClick={() => navigate(action.to)}
          />
        ))}
      </div>

      <div className="mb-10">
        <RecommendCard
          title="智能推荐"
          highlight="上传文档后，Tina 会根据你的学习记录推荐相关内容。"
          description="上传第一份文档，让 Tina 帮你建立知识体系。"
          actionLabel="上传资料"
          onAction={() => navigate("/knowledge/upload")}
        />
      </div>

      <div className="mb-4">
        <SectionHeader title="最近内容">
          <Button variant="ghost" size="sm" onClick={() => navigate("/notes")}>
            查看全部
            <ArrowRight className="w-4 h-4" strokeWidth={2} />
          </Button>
        </SectionHeader>
        {recentItems.length === 0 ? (
          <div className="text-body text-ink-tertiary py-8 text-center">
            暂无最近内容，开始你的学习之旅吧
          </div>
        ) : (
          <RecentList
            items={recentItems.map((r, i) => ({
              ...r,
              icon: i % 2 === 0 ? FileText : Lightbulb,
              iconTone: i % 2 === 0 ? ("neutral" as const) : ("primary" as const),
            }))}
          />
        )}
      </div>

      <RightPanelSlot suggestions={suggestions} />
    </AppShell>
  )
}

function RightPanelSlot({ suggestions }: { suggestions: string[] }) {
  const navigate = useNavigate()
  return (
    <RightPanel title="今日状态">
      <div className="space-y-6">
        <section>
          <h3 className="text-card-title font-semibold text-ink-primary mb-3">今日学习</h3>
          <div className="space-y-2.5">
            <StatusRow icon={Clock} label="学习时长" value="—" />
            <StatusRow icon={FileStack} label="待复习" value="—" />
            <StatusRow icon={FileText} label="待整理" value="—" />
          </div>
        </section>

        <section>
          <h3 className="text-card-title font-semibold text-ink-primary mb-3 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-primary" strokeWidth={2} />
            Tina 建议
          </h3>
            <div className="space-y-2">
              {suggestions.map((s, i) => (
                <div key={i} className="flex items-start gap-2 p-3 rounded-md bg-primary-subtle border border-primary/10">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                  <span className="text-caption text-ink-primary leading-relaxed">{s}</span>
                </div>
              ))}
            </div>
        </section>

        <section>
          <h3 className="text-card-title font-semibold text-ink-primary mb-3">快捷入口</h3>
          <div className="grid grid-cols-1 gap-2">
            {rightPanelShortcuts.map((sc) => (
              <button
                key={sc.label}
                onClick={() => navigate(sc.to)}
                className="flex items-center justify-between px-3 h-10 rounded-md bg-surface border border-line-soft text-body text-ink-secondary hover:border-primary/30 hover:text-primary transition-all group"
              >
                {sc.label}
                <ArrowRight className="w-4 h-4 text-ink-tertiary group-hover:text-primary group-hover:translate-x-0.5 transition-all" strokeWidth={2} />
              </button>
            ))}
          </div>
        </section>
      </div>
    </RightPanel>
  )
}

function StatusRow({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 rounded-md bg-surface-soft text-ink-secondary flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4" strokeWidth={2} />
      </div>
      <div className="flex-1 flex items-center justify-between">
        <span className="text-caption text-ink-secondary">{label}</span>
        <span className="text-body text-ink-primary font-medium">{value}</span>
      </div>
    </div>
  )
}