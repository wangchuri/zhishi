import { useEffect, useState } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import { Loader2, NotebookPen, StickyNote } from "lucide-react"
import { AppShell } from "@/components/layout/AppShell"
import { EmptyState } from "@/components/ui/empty-state"
import { SearchInput } from "@/components/ui/search-input"
import { notesApi, type NoteItem } from "@/lib/api"
import { NoteCard } from "@/components/blocks/NoteCard"
import { TipDeck } from "@/features/notes/TipDeck"
import { cn } from "@/lib/utils"
import type { Note } from "@/types"

function toNote(n: NoteItem): Note {
  const excerpt = (n.content_md || "").replace(/[#*`>_-]/g, "").replace(/\s+/g, " ").trim()
  return {
    id: n.id,
    title: n.title || "无标题",
    excerpt: excerpt.slice(0, 120),
    tags: n.note_type === "report" ? ["学习报告"] : [],
    updatedAt: n.created_at ? formatDate(n.created_at) : "—",
    wordCount: (n.content_md || "").length,
    source: n.note_type === "report" ? "ai" : "manual",
    hasAISummary: n.note_type === "report",
    organized: false,
    content_md: n.content_md || "",
    document_id: n.document_id ?? undefined,
    note_type: n.note_type,
    created_at: n.created_at,
    page_number: n.page_number ?? undefined,
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
  const navigate = useNavigate()
  const location = useLocation()
  const [notes, setNotes] = useState<NoteItem[]>([])
  const [tips, setTips] = useState<NoteItem[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState(false)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const tab = location.hash === "#tips" ? "tips" : "notes"

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([
      notesApi.list({ limit: 100 }),
    ]).then(([all]) => {
      if (cancelled) return
      const items = all.status === "fulfilled" ? all.value.notes || [] : []
      setTips(items.filter((n) => n.note_type === "tip"))
      setNotes(items.filter((n) => n.note_type !== "tip"))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const setTab = (next: "notes" | "tips") => {
    navigate({ pathname: "/notes", hash: next === "tips" ? "tips" : "notes" }, { replace: true })
    if (next !== "tips") setExpanded(false)
  }

  const cycle = () => {
    const shown = tagFilter ? tips.filter((t) => (t.tags || []).includes(tagFilter)) : tips
    if (expanded || shown.length < 2) return
    const first = shown[0]
    const restShown = shown.slice(1)
    const hidden = tagFilter ? tips.filter((t) => !(t.tags || []).includes(tagFilter)) : []
    setTips([...restShown, first, ...hidden])
  }

  const stackOn = (id: string) => {
    setTips((prev) => {
      const idx = prev.findIndex((t) => t.id === id)
      if (idx < 0) return prev
      const next = [...prev]
      const [picked] = next.splice(idx, 1)
      return [picked, ...next]
    })
    setExpanded(false)
  }

  const filteredNotes = query.trim()
    ? notes.filter((n) => (n.title || "").includes(query) || (n.content_md || "").includes(query))
    : notes
  const tipTags = Array.from(new Set(tips.flatMap((t) => t.tags || [])))
  const shownTips = tagFilter ? tips.filter((t) => (t.tags || []).includes(tagFilter)) : tips

  return (
    <AppShell maxWidth={1180}>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-[1.85rem] text-ink mb-1">{tab === "tips" ? "tip" : "笔记"}</h1>
          <p className="text-body text-ink-soft">
            {tab === "tips"
              ? "划选收进来的短卡片。点最上面一张会抽到最底下。tag 是你自己的分类。"
              : "学习报告和自己写下的长内容。"}
          </p>
        </div>
        <div className="flex rounded-xl border border-line bg-paper p-0.5 text-small shrink-0">
          <button
            type="button"
            onClick={() => setTab("notes")}
            className={cn(
              "px-4 py-1.5 rounded-lg font-medium transition-colors",
              tab === "notes" ? "bg-sea text-paper" : "text-ink-soft hover:text-sea",
            )}
          >
            笔记 {notes.length}
          </button>
          <button
            type="button"
            onClick={() => setTab("tips")}
            className={cn(
              "px-4 py-1.5 rounded-lg font-medium transition-colors",
              tab === "tips" ? "bg-sea text-paper" : "text-ink-soft hover:text-sea",
            )}
          >
            tip {tips.length}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-ink-disabled gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>加载中…</span>
        </div>
      ) : tab === "tips" ? (
        <section>
          {tips.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setTagFilter(null)}
                  className={cn(
                    "h-7 px-2.5 rounded-full border text-[11px] font-medium",
                    !tagFilter ? "bg-sea text-paper border-sea" : "border-line text-ink-soft bg-paper",
                  )}
                >
                  全部
                </button>
                {tipTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setTagFilter(tag)}
                    className={cn(
                      "h-7 px-2.5 rounded-full border text-[11px] font-medium",
                      tagFilter === tag ? "bg-sea text-paper border-sea" : "border-line text-ink-soft bg-paper hover:border-sea/40",
                    )}
                  >
                    {tag}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                {!expanded && (
                  <button
                    type="button"
                    onClick={cycle}
                    className="h-8 px-3 rounded-full border border-line bg-paper text-caption text-ink-soft hover:text-sea hover:border-sea/40"
                  >
                    下一张
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="h-8 px-3 rounded-full bg-sea text-paper text-caption font-medium"
                >
                  {expanded ? "收成堆叠" : "全部展开"}
                </button>
              </div>
            </div>
          )}
          <div className="rounded-2xl border border-line bg-paper-2/50 p-5 sm:p-6">
            {tips.length === 0 ? (
              <EmptyState
                icon={StickyNote}
                title="还没有 tip"
                description="划选文字后点 tip，可以选关联资料、打自己的分类 tag。"
                size="md"
              />
            ) : (
              <>
                <p className="text-caption text-ink-disabled mb-4">
                  点最上面一张会抽到最底下。展开后点其中一张，会重新叠回去。
                </p>
                <TipDeck
                  tips={shownTips}
                  expanded={expanded}
                  onCycle={cycle}
                  onPick={stackOn}
                  onOpen={(id) => navigate(`/notes/${id}`)}
                />
              </>
            )}
          </div>
        </section>
      ) : (
        <section>
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 max-w-md">
              <SearchInput placeholder="搜索笔记..." value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>
          {filteredNotes.length === 0 ? (
            <div className="rounded-2xl border border-line bg-paper p-4">
              <EmptyState
                icon={NotebookPen}
                title={notes.length === 0 ? "还没有长笔记" : "没有匹配的笔记"}
                description={
                  notes.length === 0
                    ? "学习报告会保存在这里。短摘录请到 tip。"
                    : "换个关键词试试。"
                }
                size="lg"
              />
            </div>
          ) : (
            <div className="rounded-2xl border border-line bg-paper p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredNotes.map((n) => (
                  <NoteCard
                    key={n.id}
                    note={toNote(n)}
                    onClick={() => navigate(`/notes/${n.id}`)}
                    className="rounded-2xl bg-paper-2 border-line"
                  />
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </AppShell>
  )
}
