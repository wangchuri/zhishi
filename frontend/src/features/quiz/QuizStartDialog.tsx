import { useMemo, useState, type ReactNode } from "react"
import { ChevronDown, ChevronRight, Loader2, Play, RefreshCw, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { LearningPathChapter, Question, QuizSession } from "@/types"
import {
  DIFFICULTY_OPTIONS,
  QUIZ_TYPE_KEYS,
  QUIZ_TYPE_LABELS,
  buildQuizStartBody,
  countByBucket,
  countByChapter,
  countByDifficulty,
  countQuizSelection,
  customCountTotal,
  emptyQuizStartSelection,
  quizStartTotal,
  type QuizStartSelection,
} from "./quizStartSelection"

/** 数量快捷档（0 = 全部） */
const COUNT_PRESETS = [5, 10, 20, 0]

type QuizStartDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 当前范围内全部题目（用来做实时过滤/数量提示） */
  questions: Question[]
  /** 书本章节（资料组不传，则整段章节选择不显示） */
  chapters?: LearningPathChapter[]
  availableTags: string[]
  activeSession?: QuizSession | null
  onResume?: () => void
  starting?: boolean
  /** 创建会话：父组件只需要提供范围（文档 / 资料组）和标题 */
  scope: { documentId?: string; groupId?: string; title?: string }
  onStart: (body: Record<string, unknown>) => void
}

function chipClass(active: boolean, disabled = false): string {
  return cn(
    "rounded-full px-2.5 py-1 text-caption font-medium border transition-colors",
    disabled && "opacity-40 cursor-not-allowed",
    active
      ? "bg-sea text-paper border-sea"
      : "bg-paper text-ink-soft border-line hover:border-sea/35",
  )
}

function SectionLabel({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-1.5">
      <span className="text-small font-medium text-ink-primary">{children}</span>
      {hint ? <span className="text-caption text-ink-tertiary">{hint}</span> : null}
    </div>
  )
}

/** 刷题浮窗：章节 / 题型 / 难度 / 知识点 + 数量与分布，一次选定后开始。 */
export function QuizStartDialog({
  open,
  onOpenChange,
  questions,
  chapters,
  availableTags,
  activeSession,
  onResume,
  starting,
  scope,
  onStart,
}: QuizStartDialogProps) {
  const [sel, setSel] = useState<QuizStartSelection>(() => emptyQuizStartSelection())
  const [tagsOpen, setTagsOpen] = useState(false)
  const [tagQuery, setTagQuery] = useState("")

  // 每次打开重置（默认全选：章节/题型/知识点都不限，难度不限）。
  // 用「渲染期间按 props 变化调整 state」的写法，避免 effect 里同步 setState 触发级联渲染。
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setSel(emptyQuizStartSelection())
      setTagsOpen(false)
      setTagQuery("")
    }
  }

  const typeCounts = useMemo(() => countByBucket(questions), [questions])
  const difficultyCounts = useMemo(() => countByDifficulty(questions), [questions])
  const chapterCounts = useMemo(() => countByChapter(questions), [questions])

  const chapterRows = useMemo(() => {
    const list = (chapters || [])
      .map((ch, i) => ({
        id: (ch.id || "").trim(),
        title: ch.title || `第 ${ch.order || i + 1} 章`,
        count: ch.id ? chapterCounts[ch.id] || 0 : 0,
      }))
      .filter((c) => c.id)
    return list
  }, [chapters, chapterCounts])

  const matched = useMemo(() => countQuizSelection(questions, sel), [questions, sel])
  const total = quizStartTotal(sel, matched)
  const customTotal = customCountTotal(sel)

  const visibleTags = useMemo(() => {
    const q = tagQuery.trim().toLowerCase()
    if (!q) return availableTags
    return availableTags.filter((t) => t.toLowerCase().includes(q))
  }, [availableTags, tagQuery])

  const toggle = <T,>(list: T[], v: T): T[] =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v]

  const availableTypeKeys = QUIZ_TYPE_KEYS.filter((k) => (typeCounts[k] || 0) > 0)

  const start = () => {
    if (matched === 0) return
    if (sel.distribute === "custom" && customTotal === 0) return
    onStart(buildQuizStartBody(sel, scope))
  }

  const disabled = starting || matched === 0 || (sel.distribute === "custom" && customTotal === 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[88dvh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 shrink-0">
          <DialogTitle>刷题</DialogTitle>
          <DialogDescription>
            默认全选；点一项就只刷那一项。当前条件下约 {matched} 题可刷。
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin px-5 pb-4 space-y-4">
          {activeSession && onResume ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-line-soft bg-surface-soft px-3 py-2">
              <div className="flex items-center gap-2 min-w-0 text-small text-ink-primary">
                <RefreshCw className="w-4 h-4 text-sea shrink-0" />
                <span className="truncate">
                  有未完成的练习（{activeSession.answered_count}/{activeSession.total_questions} 题已答）
                </span>
              </div>
              <Button variant="secondary" size="sm" onClick={onResume}>
                继续
              </Button>
            </div>
          ) : null}

          {chapterRows.length > 0 && (
            <div>
              <SectionLabel hint="默认全书">章节</SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className={chipClass(sel.chapterIds.length === 0)}
                  onClick={() => setSel((s) => ({ ...s, chapterIds: [] }))}
                >
                  全部
                </button>
                {chapterRows.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={c.count === 0}
                    title={c.count === 0 ? "这一章还没有题目" : c.title}
                    className={chipClass(sel.chapterIds.includes(c.id), c.count === 0)}
                    onClick={() => setSel((s) => ({ ...s, chapterIds: toggle(s.chapterIds, c.id) }))}
                  >
                    {c.title}
                    <span className="ml-1 opacity-70">{c.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <SectionLabel hint="默认全部">题型</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className={chipClass(sel.types.length === 0)}
                onClick={() => setSel((s) => ({ ...s, types: [] }))}
              >
                全部
              </button>
              {availableTypeKeys.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={chipClass(sel.types.includes(k))}
                  onClick={() => setSel((s) => ({ ...s, types: toggle(s.types, k) }))}
                >
                  {QUIZ_TYPE_LABELS[k] || k}
                  <span className="ml-1 opacity-70">{typeCounts[k] || 0}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <SectionLabel hint="默认不限（含未标注的老题）">难度</SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className={chipClass(sel.difficulties.length === 0)}
                onClick={() => setSel((s) => ({ ...s, difficulties: [] }))}
              >
                不限
              </button>
              {DIFFICULTY_OPTIONS.map((d) => {
                const n = difficultyCounts[d.value] || 0
                return (
                  <button
                    key={d.value}
                    type="button"
                    disabled={n === 0}
                    title={n === 0 ? "暂无标注为该难度的题（老题没有难度标注）" : `${d.label} ${n} 题`}
                    className={chipClass(sel.difficulties.includes(d.value), n === 0)}
                    onClick={() =>
                      setSel((s) => ({ ...s, difficulties: toggle(s.difficulties, d.value) }))
                    }
                  >
                    {d.label}
                    <span className="ml-1 opacity-70">{n}</span>
                  </button>
                )
              })}
            </div>
            <p className="mt-1.5 text-caption text-ink-tertiary">
              题目的难度由出题时标注；勾了具体难度后，没有标注的老题不会参与。
            </p>
          </div>

          {availableTags.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setTagsOpen((v) => !v)}
                className="w-full flex items-center gap-2 text-left"
              >
                {tagsOpen ? (
                  <ChevronDown className="w-3.5 h-3.5 text-ink-tertiary" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-ink-tertiary" />
                )}
                <span className="text-small font-medium text-ink-primary">知识点</span>
                <span className="text-caption text-ink-tertiary">
                  {sel.tags.length === 0 ? "全部" : `已选 ${sel.tags.length} 个`}
                </span>
              </button>
              {tagsOpen && (
                <div className="mt-2 space-y-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-ink-tertiary absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      value={tagQuery}
                      onChange={(e) => setTagQuery(e.target.value)}
                      placeholder="搜索知识点"
                      className="w-full h-8 pl-8 pr-3 rounded-lg border border-line-soft bg-surface-soft text-small text-ink-primary placeholder:text-ink-tertiary focus:outline-none focus:ring-2 focus:ring-sea/30"
                    />
                  </div>
                  <div className="max-h-40 overflow-y-auto scroll-thin">
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        className={chipClass(sel.tags.length === 0)}
                        onClick={() => setSel((s) => ({ ...s, tags: [] }))}
                      >
                        全部
                      </button>
                      {visibleTags.map((t) => (
                        <button
                          key={t}
                          type="button"
                          className={chipClass(sel.tags.includes(t))}
                          onClick={() => setSel((s) => ({ ...s, tags: toggle(s.tags, t) }))}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <SectionLabel>分布</SectionLabel>
            <div className="flex gap-1.5 mb-2">
              <button
                type="button"
                className={chipClass(sel.distribute === "balanced")}
                onClick={() => setSel((s) => ({ ...s, distribute: "balanced" }))}
              >
                均衡随机
              </button>
              <button
                type="button"
                className={chipClass(sel.distribute === "custom")}
                onClick={() => setSel((s) => ({ ...s, distribute: "custom" }))}
              >
                自定义每种题型数量
              </button>
            </div>

            {sel.distribute === "balanced" ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-caption text-ink-tertiary">数量</span>
                <input
                  type="number"
                  min={0}
                  max={Math.max(matched, 1)}
                  value={sel.count === 0 ? "" : sel.count}
                  placeholder="全部"
                  onChange={(e) => {
                    const raw = e.target.value.trim()
                    if (raw === "") return setSel((s) => ({ ...s, count: 0 }))
                    const n = Math.max(0, Number(raw) || 0)
                    setSel((s) => ({ ...s, count: n }))
                  }}
                  className="w-20 h-8 px-2 rounded-md border border-line-soft bg-paper text-body text-ink focus:outline-none focus:border-sea"
                />
                {COUNT_PRESETS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={chipClass(sel.count === n)}
                    onClick={() => setSel((s) => ({ ...s, count: n }))}
                  >
                    {n === 0 ? "全部" : n}
                  </button>
                ))}
              </div>
            ) : (
              <div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {(sel.types.length ? sel.types : availableTypeKeys).map((k) => {
                    const max = typeCounts[k] || 0
                    return (
                      <label
                        key={k}
                        className={cn(
                          "rounded-lg border p-2",
                          max === 0 ? "border-line-soft opacity-50" : "border-line-soft",
                        )}
                      >
                        <div className="text-caption font-medium text-ink-primary mb-1">
                          {QUIZ_TYPE_LABELS[k] || k}
                        </div>
                        <input
                          type="number"
                          min={0}
                          max={max}
                          disabled={max === 0}
                          value={sel.typeCounts[k] ?? ""}
                          placeholder="0"
                          onChange={(e) => {
                            const raw = e.target.value
                            const n = raw === "" ? 0 : Math.max(0, Math.min(Number(raw) || 0, max))
                            setSel((s) => ({ ...s, typeCounts: { ...s.typeCounts, [k]: n } }))
                          }}
                          className="w-full h-8 px-2 rounded-md border border-line-soft bg-paper text-body text-ink focus:outline-none focus:border-sea disabled:cursor-not-allowed"
                        />
                        <div className="text-[11px] text-ink-tertiary mt-1">最多 {max}</div>
                      </label>
                    )
                  })}
                </div>
                <p className="mt-1.5 text-caption text-ink-tertiary">
                  合计 {customTotal} 题（材料题按「整段材料」算一组，会连子题一起带出来）
                </p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="px-5 py-4 border-t border-line-soft shrink-0">
          {matched === 0 ? (
            <span className="text-caption text-ink-tertiary flex-1 self-center">
              当前条件下没有题目，换个章节/题型/难度试试
            </span>
          ) : null}
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            variant="primary"
            onClick={start}
            disabled={disabled}
            style={{ color: "#FFFFFF" }}
          >
            {starting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" strokeWidth={2} />
            )}
            开始刷题{total > 0 && matched > 0 ? `（${total} 题）` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
