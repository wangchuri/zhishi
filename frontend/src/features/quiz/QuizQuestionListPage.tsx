import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Filter, Loader2, Search } from "lucide-react"
import { AppShell } from "@/components/layout/AppShell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { QuestionDetailBody } from "./QuizQuestionDetailPage"
import { QUESTION_TYPE_LABEL } from "./quizQuestionUtils"
import { questionsApi } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { Question, QuestionListResult } from "@/types"

type StatusKey = "all" | "todo" | "correct" | "wrong" | "unknown"

const STATUS_FILTERS: { key: StatusKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "todo", label: "未做" },
  { key: "correct", label: "答对" },
  { key: "wrong", label: "答错" },
  { key: "unknown", label: "不会" },
]

const TYPE_FILTERS = [
  { key: "all", label: "全部题型" },
  { key: "single_choice", label: "单选" },
  { key: "multiple_choice", label: "多选" },
  { key: "fill_blank", label: "填空" },
  { key: "short_answer", label: "简答" },
  { key: "application", label: "应用" },
]

const DIFF_FILTERS = [
  { key: "all", label: "全部难度" },
  { key: "1", label: "简单" },
  { key: "2", label: "中等" },
  { key: "3", label: "困难" },
  { key: "0", label: "未标注" },
]

const DIFF_LABEL: Record<number, string> = { 1: "简单", 2: "中等", 3: "困难" }

function statusOf(q: Question): Exclude<StatusKey, "all"> {
  if (!q.attempt_count) return "todo"
  const s = q.user_answer_status
  if (s === "correct" || s === "wrong" || s === "unknown") return s
  return "todo"
}

const STATUS_BADGE: Record<Exclude<StatusKey, "all">, { label: string; variant: "success" | "danger" | "warning" | "neutral" }> = {
  todo: { label: "未做", variant: "neutral" },
  correct: { label: "答对", variant: "success" },
  wrong: { label: "答错", variant: "danger" },
  unknown: { label: "不会", variant: "warning" },
}

/** 题干摘要：去掉 markdown 图片/公式符号，只留能看懂的字符 */
function plainStem(stem: string, max = 90): string {
  const text = (stem || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "［图］")
    .replace(/\$\$?/g, "")
    .replace(/[#>*`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/**
 * 题目页：左边筛选 + 题目列表，右边题目详情。
 * 取代原来「查看题目」的弹窗——手机上弹窗里翻题很难受。
 */
export function QuizQuestionListPage() {
  const { docId = "" } = useParams<{ docId: string }>()
  const navigate = useNavigate()

  const [data, setData] = useState<QuestionListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [keyword, setKeyword] = useState("")
  const [status, setStatus] = useState<StatusKey>("all")
  const [qtype, setQtype] = useState("all")
  const [difficulty, setDifficulty] = useState("all")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)

  const load = useCallback(async () => {
    if (!docId) return
    setLoading(true)
    setError("")
    try {
      const res = await questionsApi.list({ document_id: docId })
      const list = (res as QuestionListResult).questions || []
      setData(res as QuestionListResult)
      setSelectedId((prev) => prev || list[0]?.id || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载题目失败")
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [docId])

  useEffect(() => {
    void load()
  }, [load])

  const all = data?.questions || []

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    return all.filter((q) => {
      if (status !== "all" && statusOf(q) !== status) return false
      if (qtype !== "all" && q.question_type !== qtype) return false
      if (difficulty !== "all") {
        const d = q.difficulty ?? 0
        if (String(d) !== difficulty) return false
      }
      if (k) {
        const hay = `${q.stem || ""} ${(q.tags || []).join(" ")}`.toLowerCase()
        if (!hay.includes(k)) return false
      }
      return true
    })
  }, [all, keyword, status, qtype, difficulty])

  // 筛选后如果当前选中项被过滤掉，自动选中第一条
  useEffect(() => {
    if (filtered.length === 0) return
    if (!selectedId || !filtered.some((q) => q.id === selectedId)) {
      setSelectedId(filtered[0].id)
    }
  }, [filtered, selectedId])

  const selected = filtered.find((q) => q.id === selectedId) || null
  const counts = useMemo(() => {
    const out: Record<StatusKey, number> = { all: all.length, todo: 0, correct: 0, wrong: 0, unknown: 0 }
    for (const q of all) out[statusOf(q)] += 1
    return out
  }, [all])

  return (
    <AppShell maxWidth={1320} noPadding>
      <div className="flex h-full">
        {/* 左：筛选 + 列表（手机上选中题目后隐藏，看详情） */}
        <aside
          className={cn(
            "w-full md:w-[360px] md:shrink-0 border-r border-line flex-col min-h-0",
            selected ? "hidden md:flex" : "flex"
          )}
        >
          <div className="shrink-0 px-3 py-2.5 border-b border-line space-y-2">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => navigate(`/quiz/doc/${docId}`)}>
                <ArrowLeft className="w-4 h-4" strokeWidth={2} />
                资料
              </Button>
              <span className="text-small text-ink-tertiary ml-auto tabular-nums">
                {filtered.length}/{all.length} 题
              </span>
              <Button
                variant={showFilters ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setShowFilters((v) => !v)}
                aria-label="筛选"
              >
                <Filter className="w-4 h-4" strokeWidth={2} />
              </Button>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-disabled" strokeWidth={2} />
              <input
                type="search"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索题干、标签"
                className="w-full h-9 pl-9 pr-3 rounded-[4px] bg-paper-2 border border-line text-small text-ink placeholder:text-ink-disabled focus:outline-none focus:border-sea"
              />
            </div>

            {/* 状态筛选常驻；题型/难度收进「筛选」 */}
            <div className="flex flex-wrap gap-1.5">
              {STATUS_FILTERS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setStatus(opt.key)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-caption font-medium transition-colors",
                    status === opt.key
                      ? "bg-sea text-paper"
                      : "bg-paper text-ink-soft border border-line hover:border-sea/35"
                  )}
                >
                  {opt.label} {counts[opt.key]}
                </button>
              ))}
            </div>

            {showFilters && (
              <div className="space-y-2 pt-1">
                <div className="flex flex-wrap gap-1.5">
                  {TYPE_FILTERS.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setQtype(opt.key)}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-caption transition-colors",
                        qtype === opt.key
                          ? "bg-ink text-paper"
                          : "bg-paper text-ink-soft border border-line hover:border-sea/35"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {DIFF_FILTERS.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setDifficulty(opt.key)}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-caption transition-colors",
                        difficulty === opt.key
                          ? "bg-ink text-paper"
                          : "bg-paper text-ink-soft border border-line hover:border-sea/35"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto scroll-thin p-2 space-y-1.5">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-ink-tertiary">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-small">加载题目…</span>
              </div>
            ) : error ? (
              <div className="m-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-small text-ink">
                {error}
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-small text-ink-tertiary text-center py-12">
                {all.length === 0 ? "这本书还没有题目" : "没有符合筛选的题目"}
              </p>
            ) : (
              filtered.map((q, i) => {
                const st = STATUS_BADGE[statusOf(q)]
                const active = q.id === selectedId
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setSelectedId(q.id)}
                    className={cn(
                      "w-full text-left rounded-lg border px-3 py-2.5 transition-colors",
                      active
                        ? "border-sea/50 bg-primary-soft/40"
                        : "border-line-soft bg-paper hover:border-sea/35"
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-1.5 mb-1">
                      <span className="text-caption text-ink-tertiary tabular-nums">{i + 1}.</span>
                      <Badge variant="primary" size="sm">
                        {QUESTION_TYPE_LABEL[q.question_type] || q.question_type || "题目"}
                      </Badge>
                      <Badge variant={st.variant} size="sm">
                        {st.label}
                      </Badge>
                      {q.difficulty ? (
                        <span className="text-caption text-ink-tertiary">
                          {DIFF_LABEL[q.difficulty] || ""}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-small text-ink-primary leading-relaxed line-clamp-2">
                      {plainStem(q.stem) || "（无题干）"}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </aside>

        {/* 右：详情（手机上未选中时隐藏） */}
        <div className={cn("flex-1 min-w-0 overflow-y-auto scroll-thin", selected ? "block" : "hidden md:block")}>
          <div className="p-4 md:p-6 max-w-[880px] mx-auto">
            {selected ? (
              <>
                <div className="mb-3 md:hidden">
                  <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
                    <ArrowLeft className="w-4 h-4" strokeWidth={2} />
                    题目列表
                  </Button>
                </div>
                <QuestionDetailBody questionId={selected.id} />
                <div className="h-8" />
              </>
            ) : (
              <p className="text-body text-ink-tertiary text-center py-24">
                {all.length === 0 ? "这本书还没有题目" : "从左侧选一道题"}
              </p>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  )
}
