import { useEffect, useState, type DragEvent, type HTMLAttributes, type ReactNode } from "react"
import {
  BookOpen,
  ChevronDown,
  Lightbulb,
  ListChecks,
  Loader2,
  MessageSquare,
  Plus,
  Send,
  Sparkles,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { MarkdownWithMath } from "@/components/blocks/MarkdownWithMath"
import { SearchInput } from "@/components/ui/search-input"
import { BookOutline } from "@/features/notes/BookOutline"
import {
  chatApi,
  materialsApi,
  notesApi,
  questionsApi,
  type MaterialItem,
  type NoteItem,
} from "@/lib/api"
import { cn } from "@/lib/utils"

type TabKey = "tina" | "tip" | "question" | "material" | "outline"

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "tina", label: "Tina" },
  { key: "tip", label: "tip" },
  { key: "question", label: "题目" },
  { key: "material", label: "材料" },
]

interface QuestionOption {
  key: string
  text: string
}

interface RawQuestion {
  id: string
  stem?: string
  question_type?: string
  user_answer_status?: string | null
  options?: QuestionOption[] | null
  answer?: string | null
  explanation?: string | null
}

const STATUS_CHIPS = [
  { key: "all", label: "全部" },
  { key: "wrong", label: "错" },
  { key: "unknown", label: "不会" },
  { key: "correct", label: "对" },
  { key: "undone", label: "未做" },
]

const STATUS_LABEL: Record<string, string> = {
  correct: "对",
  wrong: "错",
  unknown: "不会",
  undone: "未做",
}

const STATUS_CLASS: Record<string, string> = {
  correct: "bg-success-soft text-success",
  wrong: "bg-danger-soft text-danger",
  unknown: "bg-warning-soft text-warning",
  undone: "bg-paper-deep text-ink-disabled",
}

function statusOf(q: RawQuestion): string {
  return q.user_answer_status || "undone"
}

interface CollapsibleRowProps {
  icon: LucideIcon
  title: string
  badge?: string
  badgeClass?: string
  open: boolean
  onToggle: () => void
  onQuickInsert: () => void
  dragProps?: HTMLAttributes<HTMLDivElement> & { draggable?: boolean }
  children?: ReactNode
}

function CollapsibleRow({
  icon: Icon,
  title,
  badge,
  badgeClass,
  open,
  onToggle,
  onQuickInsert,
  dragProps,
  children,
}: CollapsibleRowProps) {
  return (
    <div
      {...dragProps}
      className={cn(
        "rounded-lg border bg-paper-2/50 transition-colors",
        open ? "border-sea/45" : "border-line-light hover:border-sea/35",
      )}
    >
      <div
        role="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 px-2.5 py-2 cursor-pointer"
        title="点击展开 / 收起"
      >
        <Icon className="w-3.5 h-3.5 text-ink-disabled shrink-0" strokeWidth={2} />
        <span className="text-caption text-ink truncate-1 flex-1">{title}</span>
        {badge ? (
          <span className={cn("shrink-0 h-4 px-1.5 rounded-full text-[10px]", badgeClass)}>
            {badge}
          </span>
        ) : null}
        <button
          type="button"
          title="插入到笔记"
          onClick={(e) => {
            e.stopPropagation()
            onQuickInsert()
          }}
          className="shrink-0 h-5 w-5 grid place-items-center rounded-full text-ink-disabled hover:bg-sea-subtle hover:text-sea"
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={2} />
        </button>
        <ChevronDown
          className={cn("w-3.5 h-3.5 text-ink-disabled shrink-0 transition-transform", open && "rotate-180")}
          strokeWidth={2}
        />
      </div>
      {open ? <div className="px-2.5 pb-2.5 border-t border-line-light">{children}</div> : null}
    </div>
  )
}

function QuestionBody({ q, onInsert }: { q: RawQuestion; onInsert: () => void }) {
  const isChoice = !q.question_type || q.question_type === "single_choice"
  const options = q.options || []
  const [selected, setSelected] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const answered = selected !== null || revealed
  const correct = (q.answer || "").trim().toUpperCase()

  return (
    <div className="pt-2 space-y-2">
      <div className="text-caption text-ink leading-relaxed">
        <MarkdownWithMath>{q.stem || ""}</MarkdownWithMath>
      </div>

      {isChoice && options.length > 0 ? (
        <div className="space-y-1">
          {options.map((o) => {
            const isSel = selected === o.key
            const isCorrect = answered && o.key.toUpperCase() === correct
            const isWrong = answered && isSel && o.key.toUpperCase() !== correct
            return (
              <button
                key={o.key}
                type="button"
                disabled={answered}
                onClick={() => setSelected(o.key)}
                className={cn(
                  "w-full text-left text-caption rounded-md border px-2 py-1.5 transition-colors",
                  isCorrect
                    ? "border-success bg-success-soft text-success"
                    : isWrong
                      ? "border-danger bg-danger-soft text-danger"
                      : isSel
                        ? "border-sea bg-sea-subtle text-ink"
                        : "border-line-light text-ink-soft hover:border-sea/40",
                )}
              >
                <span className="font-medium mr-1">{o.key}.</span>
                {o.text}
              </button>
            )
          })}
        </div>
      ) : null}

      {!isChoice ? (
        !revealed ? (
          <Button variant="secondary" size="sm" onClick={() => setRevealed(true)}>
            看答案
          </Button>
        ) : null
      ) : null}

      {answered ? (
        <div className="rounded-md bg-paper px-2 py-1.5 text-[11px] text-ink-soft space-y-1">
          <div>
            答案：<span className="text-sea font-medium">{correct || "—"}</span>
          </div>
          {q.explanation ? (
            <div className="text-ink-soft">
              <MarkdownWithMath>{q.explanation}</MarkdownWithMath>
            </div>
          ) : null}
        </div>
      ) : null}

      <Button variant="secondary" size="sm" onClick={onInsert}>
        插入到笔记
      </Button>
    </div>
  )
}

interface NoteSidebarProps {
  documentId?: string
  onInsert: (text: string) => void
}

export function NoteSidebar({ documentId, onInsert }: NoteSidebarProps) {
  const [tab, setTab] = useState<TabKey>("tip")
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [tipStyle, setTipStyle] = useState("card")
  const [openId, setOpenId] = useState<string | null>(null)

  const [tips, setTips] = useState<NoteItem[]>([])
  const [questions, setQuestions] = useState<RawQuestion[]>([])
  const [materials, setMaterials] = useState<MaterialItem[]>([])
  const [statusFilter, setStatusFilter] = useState("all")

  const [msgs, setMsgs] = useState<Array<{ role: string; content: string }>>([])
  const [tinaInput, setTinaInput] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([
      documentId ? notesApi.listTips(documentId) : notesApi.list({ note_type: "tip", limit: 100 }),
      questionsApi.list(documentId ? { document_id: documentId } : {}),
    ]).then(([t, q]) => {
      if (cancelled) return
      if (t.status === "fulfilled") setTips(t.value.notes || [])
      if (q.status === "fulfilled") setQuestions(q.value.questions || [])
    })
    return () => {
      cancelled = true
    }
  }, [documentId])

  useEffect(() => {
    if (tab !== "material") return
    let cancelled = false
    setLoading(true)
    materialsApi
      .list({ document_id: documentId, keyword: query.trim() || undefined, limit: 50 })
      .then((r) => {
        if (!cancelled) setMaterials(r.materials || [])
      })
      .catch(() => {
        if (!cancelled) setMaterials([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tab, query, documentId])

  const q = query.trim().toLowerCase()
  const shownTips = tips.filter(
    (t) => !q || `${t.title || ""}${t.content_md || ""}`.toLowerCase().includes(q),
  )
  const shownQuestions = questions.filter((item) => {
    if (statusFilter !== "all" && statusOf(item) !== statusFilter) return false
    return !q || (item.stem || "").toLowerCase().includes(q)
  })

  const sendTina = async () => {
    const text = tinaInput.trim()
    if (!text || busy) return
    setMsgs((m) => [...m, { role: "user", content: text }])
    setTinaInput("")
    setBusy(true)
    try {
      const res = await chatApi.send({ content: text, stream: false })
      const reply = (res && (res.content || res.message)) || ""
      setMsgs((m) => [...m, { role: "assistant", content: reply || "（Tina 没有返回内容）" }])
    } catch {
      toast.error("Tina 暂时无法回复")
    } finally {
      setBusy(false)
    }
  }

  const drag = (text: string) => (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData("text/plain", text)
    e.dataTransfer.effectAllowed = "copy"
  }

  const toggle = (id: string) => setOpenId((cur) => (cur === id ? null : id))
  const tabs = documentId ? [...TABS, { key: "outline" as TabKey, label: "目录" }] : TABS

  return (
    <aside className="flex flex-col rounded-2xl border border-line bg-paper min-h-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)]">
      <div className="flex rounded-t-2xl border-b border-line-light bg-paper-2/60 p-0.5 text-[12px] shrink-0">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key)
              setOpenId(null)
            }}
            className={cn(
              "flex-1 px-1.5 py-1.5 rounded-md font-medium transition-colors whitespace-nowrap",
              tab === t.key ? "bg-sea text-paper" : "text-ink-soft hover:text-sea",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab !== "tina" && tab !== "outline" ? (
        <div className="p-3 border-b border-line-light shrink-0">
          <SearchInput
            placeholder={tab === "material" ? "搜索材料…" : "搜索关键字…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {tab === "tip" ? (
            <div className="flex items-center gap-1.5 mt-2 text-[11px]">
              <span className="text-ink-disabled">插入样式</span>
              {[
                { key: "card", label: "卡片" },
                { key: "quote", label: "引用" },
                { key: "side", label: "边注" },
              ].map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setTipStyle(s.key)}
                  className={cn(
                    "h-6 px-2 rounded-full border font-medium",
                    tipStyle === s.key
                      ? "bg-sea text-paper border-sea"
                      : "border-line text-ink-soft hover:border-sea/40",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          ) : null}
          {tab === "question" ? (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {STATUS_CHIPS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setStatusFilter(s.key)}
                  className={cn(
                    "h-6 px-2 rounded-full border text-[11px] font-medium",
                    statusFilter === s.key
                      ? "bg-sea text-paper border-sea"
                      : "border-line text-ink-soft hover:border-sea/40",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto scroll-thin p-3 min-h-0">
        {tab === "tip" ? (
          shownTips.length === 0 ? (
            <EmptyHint icon={Lightbulb} text="没有匹配的 tip" />
          ) : (
            <div className="space-y-2">
              {shownTips.map((t) => {
                const embed = `[[tip:${t.id}|${tipStyle}]]\n`
                return (
                  <CollapsibleRow
                    key={t.id}
                    icon={Lightbulb}
                    title={t.title || "tip"}
                    open={openId === t.id}
                    onToggle={() => toggle(t.id)}
                    onQuickInsert={() => onInsert(embed)}
                    dragProps={{ draggable: true, onDragStart: drag(embed) }}
                  >
                    <div className="pt-2 text-caption text-ink leading-relaxed">
                      <MarkdownWithMath>{t.content_md || ""}</MarkdownWithMath>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-2"
                      onClick={() => onInsert(embed)}
                    >
                      插入到笔记
                    </Button>
                  </CollapsibleRow>
                )
              })}
            </div>
          )
        ) : tab === "question" ? (
          shownQuestions.length === 0 ? (
            <EmptyHint icon={ListChecks} text="没有匹配的题目" />
          ) : (
            <div className="space-y-2">
              {shownQuestions.map((item) => {
                const embed = `[[question:${item.id}]]\n`
                const st = statusOf(item)
                return (
                  <CollapsibleRow
                    key={item.id}
                    icon={ListChecks}
                    title={item.stem || "题目"}
                    badge={STATUS_LABEL[st]}
                    badgeClass={STATUS_CLASS[st]}
                    open={openId === item.id}
                    onToggle={() => toggle(item.id)}
                    onQuickInsert={() => onInsert(embed)}
                    dragProps={{ draggable: true, onDragStart: drag(embed) }}
                  >
                    <QuestionBody q={item} onInsert={() => onInsert(embed)} />
                  </CollapsibleRow>
                )
              })}
            </div>
          )
        ) : tab === "material" ? (
          loading ? (
            <div className="flex items-center justify-center py-10 text-ink-disabled gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> 检索中…
            </div>
          ) : materials.length === 0 ? (
            <EmptyHint icon={BookOpen} text="没有匹配的材料" />
          ) : (
            <div className="space-y-2">
              {materials.map((m) => {
                const embed = `[[material:${m.id}]]\n`
                return (
                  <CollapsibleRow
                    key={m.id}
                    icon={BookOpen}
                    title={m.title || m.kind || "材料"}
                    open={openId === m.id}
                    onToggle={() => toggle(m.id)}
                    onQuickInsert={() => onInsert(embed)}
                    dragProps={{ draggable: true, onDragStart: drag(embed) }}
                  >
                    <div className="pt-2 text-caption text-ink leading-relaxed max-h-64 overflow-y-auto scroll-thin">
                      <MarkdownWithMath>{m.content || ""}</MarkdownWithMath>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-2"
                      onClick={() => onInsert(embed)}
                    >
                      插入到笔记
                    </Button>
                  </CollapsibleRow>
                )
              })}
            </div>
          )
        ) : tab === "outline" && documentId ? (
          <BookOutline key={documentId} documentId={documentId} />
        ) : (
          <div className="flex flex-col h-full min-h-0">
            <div className="flex-1 space-y-2 overflow-y-auto scroll-thin">
              {msgs.length === 0 ? (
                <EmptyHint icon={MessageSquare} text="问 Tina，回答可插入笔记" />
              ) : (
                msgs.map((m, i) => (
                  <div
                    key={i}
                    className={cn(
                      "rounded-lg px-3 py-2 text-caption leading-relaxed",
                      m.role === "user" ? "bg-sea text-paper" : "bg-paper-2 text-ink",
                    )}
                  >
                    <p className="whitespace-pre-wrap">{m.content}</p>
                    {m.role === "assistant" && m.content ? (
                      <button
                        type="button"
                        onClick={() => onInsert(`${m.content}\n`)}
                        className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-sea hover:underline"
                      >
                        <Sparkles className="w-3 h-3" strokeWidth={2} />
                        插入到笔记
                      </button>
                    ) : null}
                  </div>
                ))
              )}
              {busy ? (
                <div className="flex items-center gap-2 text-caption text-ink-disabled">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Tina 正在想…
                </div>
              ) : null}
            </div>
            <div className="mt-2 flex items-end gap-2 shrink-0">
              <textarea
                value={tinaInput}
                onChange={(e) => setTinaInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    void sendTina()
                  }
                }}
                placeholder="问 Tina…"
                rows={2}
                className="flex-1 resize-none rounded-md border border-line-light bg-paper-2/50 px-2 py-1.5 text-caption focus:outline-none focus:border-sea"
              />
              <button
                type="button"
                onClick={() => void sendTina()}
                disabled={busy || !tinaInput.trim()}
                className="h-8 w-8 shrink-0 grid place-items-center rounded-full bg-ink text-paper hover:bg-sea disabled:opacity-40"
                aria-label="发送"
              >
                <Send className="w-3.5 h-3.5" strokeWidth={2} />
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}

function EmptyHint({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-ink-disabled gap-2">
      <Icon className="w-5 h-5" strokeWidth={1.8} />
      <span className="text-caption">{text}</span>
    </div>
  )
}
