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
  const [expanded, setExpanded] = useState(true)
  const [tagFilter, setTagFilter] = useState<string[]>([])
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
    if (next === "tips") setExpanded(true)
  }

  const tipMatchesFilter = (t: NoteItem) =>
    tagFilter.length === 0 || tagFilter.every((tag) => (t.tags || []).includes(tag))

  const cycle = () => {
    const shown = tips.filter(tipMatchesFilter)
    if (expanded || shown.length < 2) return
    const first = shown[0]
    const restShown = shown.slice(1)
    const hidden = tips.filter((t) => !tipMatchesFilter(t))
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

  const toggleTag = (tag: string) => {
    setTagFilter((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    )
  }

  const filteredNotes = query.trim()
    ? notes.filter((n) => (n.title || "").includes(query) || (n.content_md || "").includes(query))
    : notes
  const tipTags = Array.from(new Set(tips.flatMap((t) => t.tags || [])))
  const shownTips = tips.filter(tipMatchesFilter)

  return (
    <AppShell maxWidth={1180}>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-[1.85rem] text-ink mb-1">{tab === "tips" ? "tip" : "笔记"}</h1>
          <p className="text-body text-ink-soft">
            {tab === "tips"
              ? "划选收进来的短卡片。可多选 tag 筛选；点一张进入大卡堆叠翻看全文。"
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
                  onClick={() => setTagFilter([])}
                  className={cn(
                    "h-7 px-2.5 rounded-full border text-[11px] font-medium",
                    tagFilter.length === 0
                      ? "bg-sea text-paper border-sea"
                      : "border-line text-ink-soft bg-paper",
                  )}
                >
                  全部
                </button>
                {tipTags.map((tag) => {
                  const on = tagFilter.includes(tag)
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      className={cn(
                        "h-7 px-2.5 rounded-full border text-[11px] font-medium",
                        on
                          ? "bg-sea text-paper border-sea"
                          : "border-line text-ink-soft bg-paper hover:border-sea/40",
                      )}
                    >
                      {tag}
                    </button>
                  )
                })}
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
                  {expanded ? "堆叠翻看" : "全部展开"}
                </button>
              </div>
            </div>
          )}
          <div className="rounded-2xl border border-line bg-paper-2/50 p-5 sm:p-6">
            {tips.length === 0 ? (
              <EmptyState
                icon={StickyNote}
                title="还没有 tip"
                description="划选文字后点 tip，左侧改摘录，右侧选资料和 tag。"
                size="md"
              />
            ) : shownTips.length === 0 ? (
              <EmptyState
                icon={StickyNote}
                title="没有同时带这些 tag 的 tip"
                description="多选是「且」关系：只显示同时包含所选 tag 的卡片。点「全部」清空筛选。"
                size="md"
              />
            ) : (
              <>
                <p className="text-caption text-ink-disabled mb-4">
                  {expanded
                    ? "默认展开。点一张进入大卡堆叠，可看完整内容；点空白处或「下一张」翻牌。"
                    : "大卡显示全文。点卡片空白处抽到下一张；「全部展开」回到列表。"}
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
