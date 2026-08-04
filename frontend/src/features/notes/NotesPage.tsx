import { useEffect, useState } from "react"
import { LayoutGrid, List, NotebookPen, Loader2 } from "lucide-react"
import { AppShell } from "@/components/layout/AppShell"
import { PageHeader } from "@/components/blocks/PageHeader"
import { EmptyState } from "@/components/ui/empty-state"
import { SearchInput } from "@/components/ui/search-input"
import { SegmentedTabs } from "@/components/ui/segmented-tabs"
import { notesApi, type NoteItem } from "@/lib/api"
import { NoteCard } from "@/components/blocks/NoteCard"
import type { Note } from "@/types"

function toNote(n: NoteItem): Note {
  const excerpt = (n.content_md || "").replace(/[#*`>_-]/g, "").replace(/\s+/g, " ").trim()
  return {
    id: n.id,
    title: n.title,
    excerpt: excerpt.slice(0, 120),
    tags: [],
    updatedAt: n.created_at ? formatDate(n.created_at) : "—",
    wordCount: (n.content_md || "").length,
    source: n.note_type === "report" ? "ai" : "manual",
    hasAISummary: n.note_type === "report",
    organized: false,
    content_md: n.content_md,
    document_id: n.document_id,
    note_type: n.note_type,
    created_at: n.created_at,
  }
}

function formatDate(iso?: string): string {
  if (!iso) return "—"
  try {
    const d = new Date(iso)
    return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })
  } catch {
    return "—"
  }
}

export function NotesPage() {
  const [view, setView] = useState<"grid" | "list">("grid")
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")

  useEffect(() => {
    let cancelled = false
    notesApi
      .list({ limit: 100 })
      .then((res) => {
        if (!cancelled) setNotes((res.notes || []).map(toNote))
      })
      .catch(() => {
        if (!cancelled) setNotes([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = query.trim()
    ? notes.filter((n) => n.title.includes(query) || n.excerpt.includes(query))
    : notes

  const tipCount = notes.filter((n) => n.note_type === "tip").length
  const reportCount = notes.filter((n) => n.note_type === "report").length

  return (
    <AppShell maxWidth={1180}>
      <PageHeader title="笔记" subtitle="tip 摘录、学习报告与 AI 沉淀都会保存在这里。" />

      {/* 统计 */}
      <div className="flex items-center gap-4 mb-6 text-caption text-ink-tertiary">
        <span>全部 <strong className="text-ink-primary font-semibold">{notes.length}</strong></span>
        <span className="text-line">·</span>
        <span>摘录 <strong className="text-ink-primary font-semibold">{tipCount}</strong></span>
        <span className="text-line">·</span>
        <span>学习报告 <strong className="text-ink-primary font-semibold">{reportCount}</strong></span>
      </div>

      {/* 搜索 + 视图切换 */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
        <div className="flex-1 max-w-md">
          <SearchInput placeholder="搜索笔记..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="ml-auto">
          <SegmentedTabs
            value={view}
            onChange={(v) => setView(v as "grid" | "list")}
            tabs={[
              { label: "卡片", value: "grid", icon: LayoutGrid },
              { label: "列表", value: "list", icon: List },
            ]}
            size="sm"
          />
        </div>
      </div>

      {/* 内容区 */}
      <div className="bg-surface border border-line-soft rounded-lg shadow-xs p-4">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-ink-disabled gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>加载笔记...</span>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={NotebookPen}
            title={notes.length === 0 ? "还没有笔记" : "没有匹配的笔记"}
            description={
              notes.length === 0
                ? "在伴学阅读中划选文字「tip 到笔记」，或生成学习报告后会显示在这里。"
                : "换个关键词试试。"
            }
            size="lg"
          />
        ) : view === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((n) => (
              <NoteCard key={n.id} note={n} />
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-line-light">
            {filtered.map((n) => (
              <li key={n.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-small font-medium text-ink truncate">{n.title}</div>
                  <div className="text-caption text-ink-tertiary truncate">{n.excerpt}</div>
                </div>
                <span className="text-caption text-ink-disabled shrink-0">{n.updatedAt}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  )
}
