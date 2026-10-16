import { useMemo, useState, type ReactNode } from "react"
import { Check, ChevronDown, ChevronRight, Loader2, Play, RefreshCw, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  describeSelection,
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
  /** 这次刷谁（书名 / 资料组名），放在标题下当上下文 */
  subject?: string
  activeSession?: QuizSession | null
  onResume?: () => void
  starting?: boolean
  /** 创建会话：父组件只需要提供范围（文档 / 资料组）和标题 */
  scope: { documentId?: string; groupId?: string; title?: string }
  onStart: (body: Record<string, unknown>) => void
}

/**
 * 筛选 chip。
 *
 * 这里**不用**设计规范里「选中 = sea 实心」那套：本浮窗是若干段同样形状的 chip 行，
 * 实心胶囊会被眼睛读成「段落标题」（用户反馈过）。密集多行选择器改用
 * 「浅底 + 勾」——实心色只留给底部的主按钮，层级才立得住。
 */
function Chip({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  title?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-pressed={active ? true : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 h-10 sm:h-9 px-3.5 rounded-full border text-caption transition-colors",
        disabled
          ? "border-line-soft text-ink-tertiary opacity-45 cursor-not-allowed"
          : active
            ? "border-sea/45 bg-sea-subtle text-sea font-medium"
            : "border-line bg-paper text-ink-secondary hover:border-sea/40 hover:text-ink-primary",
      )}
    >
      {active ? <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={2.5} /> : null}
      {children}
    </button>
  )
}

/** 段：编号圆 + 标题。标题必须是这一行里最重的元素，别让 chip 抢戏。 */
function Section({
  step,
  title,
  children,
}: {
  step: number
  title: string
  children: ReactNode
}) {
  return (
    <section className="border-t border-line-soft pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2.5 mb-2.5">
        <span className="w-5 h-5 shrink-0 rounded-full bg-sea-subtle text-sea text-small font-semibold flex items-center justify-center">
          {step}
        </span>
        <span className="text-card-title text-ink-primary">{title}</span>
      </div>
      {children}
    </section>
  )
}

/** 刷题浮窗：章节 / 题型 / 难度 / 知识点 + 数量与分布，一次选定后开始。 */
export function QuizStartDialog({
  open,
  onOpenChange,
  questions,
  chapters,
  availableTags,
  subject,
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

  // 选择项只列「真的能选」的：没题的章节、没有的难度档一律不出现
  const chapterRows = useMemo(
    () =>
      (chapters || [])
        .map((ch, i) => ({
          id: (ch.id || "").trim(),
          title: ch.title || `第 ${ch.order || i + 1} 章`,
          count: ch.id ? chapterCounts[ch.id] || 0 : 0,
        }))
        .filter((c) => c.id && c.count > 0),
    [chapters, chapterCounts],
  )

  const chapterTitles = useMemo(() => {
    const out: Record<string, string> = {}
    for (const c of chapterRows) out[c.id] = c.title
    return out
  }, [chapterRows])

  const typeKeys = useMemo(
    () => QUIZ_TYPE_KEYS.filter((k) => (typeCounts[k] || 0) > 0),
    [typeCounts],
  )
  const difficultyLevels = useMemo(
    () => DIFFICULTY_OPTIONS.filter((d) => (difficultyCounts[d.value] || 0) > 0),
    [difficultyCounts],
  )

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

  // 编号：整段不显示时（资料组无章节、没有难度标注、没有标签）编号顺延
  const steps = useMemo(() => {
    let n = 0
    return {
      chapter: chapterRows.length > 0 ? ++n : 0,
      type: ++n,
      difficulty: difficultyLevels.length > 0 ? ++n : 0,
      tags: availableTags.length > 0 ? ++n : 0,
      amount: ++n,
    }
  }, [chapterRows.length, difficultyLevels.length, availableTags.length])

  const start = () => {
    if (matched === 0) return
    if (sel.distribute === "custom" && customTotal === 0) return
    onStart(buildQuizStartBody(sel, scope))
  }

  const disabled = starting || matched === 0 || (sel.distribute === "custom" && customTotal === 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:!max-w-3xl max-h-[90dvh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-5 sm:px-7 pt-5 sm:pt-6 pb-4 border-b border-line-soft shrink-0">
          <DialogTitle className="text-title-s">刷题</DialogTitle>
          {subject ? (
            <DialogDescription className="text-caption text-ink-tertiary truncate">
              {subject}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin px-5 sm:px-7 py-5 space-y-5">
          {activeSession && onResume ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-line-soft bg-surface px-4 py-2.5">
              <div className="flex items-center gap-2.5 min-w-0 text-small text-ink-secondary">
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
            <Section step={steps.chapter} title="章节">
              <div className="flex flex-wrap gap-2">
                <Chip
                  active={sel.chapterIds.length === 0}
                  onClick={() => setSel((s) => ({ ...s, chapterIds: [] }))}
                >
                  全部
                </Chip>
                {chapterRows.map((c) => (
                  <Chip
                    key={c.id}
                    active={sel.chapterIds.includes(c.id)}
                    onClick={() => setSel((s) => ({ ...s, chapterIds: toggle(s.chapterIds, c.id) }))}
                  >
                    <span className="truncate max-w-[13rem]">{c.title}</span>
                    <span className="text-small opacity-70">{c.count}</span>
                  </Chip>
                ))}
              </div>
            </Section>
          )}

          <Section step={steps.type} title="题型">
            <div className="flex flex-wrap gap-2">
              <Chip
                active={sel.types.length === 0}
                onClick={() => setSel((s) => ({ ...s, types: [] }))}
              >
                全部
              </Chip>
              {typeKeys.map((k) => (
                <Chip
                  key={k}
                  active={sel.types.includes(k)}
                  onClick={() => setSel((s) => ({ ...s, types: toggle(s.types, k) }))}
                >
                  {QUIZ_TYPE_LABELS[k] || k}
                  <span className="text-small opacity-70">{typeCounts[k] || 0}</span>
                </Chip>
              ))}
            </div>
          </Section>

          {difficultyLevels.length > 0 && (
            <Section step={steps.difficulty} title="难度">
              <div className="flex flex-wrap gap-2">
                <Chip
                  active={sel.difficulties.length === 0}
                  onClick={() => setSel((s) => ({ ...s, difficulties: [] }))}
                >
                  不限
                </Chip>
                {difficultyLevels.map((d) => (
                  <Chip
                    key={d.value}
                    active={sel.difficulties.includes(d.value)}
                    onClick={() =>
                      setSel((s) => ({ ...s, difficulties: toggle(s.difficulties, d.value) }))
                    }
                  >
                    {d.label}
                    <span className="text-small opacity-70">{difficultyCounts[d.value] || 0}</span>
                  </Chip>
                ))}
              </div>
            </Section>
          )}

          {availableTags.length > 0 && (
            <Section step={steps.tags} title="知识点">
              <button
                type="button"
                onClick={() => setTagsOpen((v) => !v)}
                className={cn(
                  "w-full flex items-center gap-2 h-10 px-3.5 rounded-lg border text-caption transition-colors",
                  sel.tags.length > 0
                    ? "border-sea/45 bg-sea-subtle text-sea"
                    : "border-line bg-paper text-ink-secondary hover:border-sea/40",
                )}
              >
                {tagsOpen ? (
                  <ChevronDown className="w-4 h-4 shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 shrink-0" />
                )}
                <span className="truncate">
                  {sel.tags.length === 0 ? "全部" : `已选 ${sel.tags.length} 个`}
                </span>
                {sel.tags.length > 0 ? <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={2.5} /> : null}
                <span className="ml-auto text-small shrink-0 opacity-80">
                  {availableTags.length}
                </span>
              </button>
              {tagsOpen && (
                <div className="mt-2.5 space-y-2.5">
                  <div className="relative">
                    <Search className="w-4 h-4 text-ink-tertiary absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      value={tagQuery}
                      onChange={(e) => setTagQuery(e.target.value)}
                      placeholder="搜索知识点"
                      className="w-full h-10 pl-9 pr-3 rounded-lg border border-line-soft bg-surface-soft text-caption text-ink-primary placeholder:text-ink-tertiary focus:outline-none focus:ring-2 focus:ring-sea/30"
                    />
                  </div>
                  <div className="max-h-44 overflow-y-auto scroll-thin">
                    <div className="flex flex-wrap gap-2">
                      <Chip
                        active={sel.tags.length === 0}
                        onClick={() => setSel((s) => ({ ...s, tags: [] }))}
                      >
                        全部
                      </Chip>
                      {visibleTags.map((t) => (
                        <Chip
                          key={t}
                          active={sel.tags.includes(t)}
                          onClick={() => setSel((s) => ({ ...s, tags: toggle(s.tags, t) }))}
                        >
                          {t}
                        </Chip>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </Section>
          )}

          <Section step={steps.amount} title="数量与分布">
            <div className="flex flex-wrap gap-2 mb-2.5">
              <Chip
                active={sel.distribute === "balanced"}
                onClick={() => setSel((s) => ({ ...s, distribute: "balanced" }))}
              >
                均衡随机
              </Chip>
              <Chip
                active={sel.distribute === "custom"}
                onClick={() => setSel((s) => ({ ...s, distribute: "custom" }))}
              >
                自定义每种题型数量
              </Chip>
            </div>

            {sel.distribute === "balanced" ? (
              <div className="rounded-lg border border-line-soft bg-surface-soft/60 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="number"
                    min={0}
                    max={Math.max(matched, 1)}
                    value={sel.count === 0 ? "" : sel.count}
                    placeholder="全部"
                    onChange={(e) => {
                      const raw = e.target.value.trim()
                      if (raw === "") return setSel((s) => ({ ...s, count: 0 }))
                      setSel((s) => ({ ...s, count: Math.max(0, Number(raw) || 0) }))
                    }}
                    className="w-24 h-10 px-3 rounded-md border border-line-soft bg-paper text-body text-ink focus:outline-none focus:border-sea"
                  />
                  <span className="text-caption text-ink-secondary">题</span>
                  <div className="flex flex-wrap gap-2">
                    {COUNT_PRESETS.map((n) => (
                      <Chip
                        key={n}
                        active={sel.count === n}
                        onClick={() => setSel((s) => ({ ...s, count: n }))}
                      >
                        {n === 0 ? "全部" : n}
                      </Chip>
                    ))}
                  </div>
                  <span className="ml-auto text-small text-ink-tertiary">最多 {matched}</span>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-line-soft bg-surface-soft/60 p-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {(sel.types.length ? sel.types : typeKeys).map((k) => {
                    const max = typeCounts[k] || 0
                    return (
                      <label key={k} className={cn("space-y-1.5", max === 0 && "opacity-50")}>
                        <div className="text-caption font-medium text-ink-primary">
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
                          className="w-full h-10 px-3 rounded-md border border-line-soft bg-paper text-body text-ink focus:outline-none focus:border-sea disabled:cursor-not-allowed"
                        />
                        <div className="text-small text-ink-tertiary">最多 {max}</div>
                      </label>
                    )
                  })}
                </div>
                <div className="mt-3 text-small text-ink-tertiary">合计 {customTotal} 题</div>
              </div>
            )}
          </Section>
        </div>

        {/* 底部：实时说明「这一场会刷什么」+ 唯一的主按钮 */}
        <div className="shrink-0 border-t border-line-soft bg-surface-soft/50 px-5 sm:px-7 py-4 space-y-3 sm:space-y-0 sm:flex sm:items-center sm:gap-4">
          <div className="sm:flex-1 min-w-0 text-caption leading-relaxed">
            {matched === 0 ? (
              <span className="text-warning">当前筛选下没有题目</span>
            ) : (
              <>
                <span className="text-ink-tertiary">本次将刷：</span>
                <span className="text-ink-primary font-medium">
                  {describeSelection(sel, matched, { chapterTitles })}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="secondary"
              size="lg"
              className="flex-1 sm:flex-none"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button
              variant="primary"
              size="lg"
              className="flex-1 sm:flex-none"
              onClick={start}
              disabled={disabled}
              style={{ color: "#FFFFFF" }}
            >
              {starting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" strokeWidth={2} />
              )}
              开始刷题{matched > 0 ? `（${total} 题）` : ""}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
