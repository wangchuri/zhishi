import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  FileText,
  HelpCircle,
  Loader2,
  Play,
  XCircle,
  RefreshCw,
  BarChart3,
} from "lucide-react"
import { AppShell } from "@/components/layout/AppShell"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { StatCard } from "@/components/ui/stat-card"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { SectionHeader } from "@/components/blocks/SectionHeader"
import { questionsApi, quizApi, analyticsApi, getThumbnailUrl } from "@/lib/api"
import { useKbDocuments } from "@/hooks/useKbDocuments"
import type { QuestionListResult, QuizSession, TagStatsResult } from "@/types"

type FilterMode = "all" | "undone" | "wrong" | "unknown"

const FILTER_OPTIONS: { value: FilterMode; label: string; desc: string }[] = [
  { value: "all", label: "从头开始", desc: "全部题目随机顺序" },
  { value: "undone", label: "只做未做题", desc: "过滤已答过的题目" },
  { value: "wrong", label: "只做错题", desc: "过滤答错的题目" },
  { value: "unknown", label: "只做不会题", desc: "过滤标记为不会的题目" },
]

export function QuizDocDetailPage() {
  const { docId } = useParams<{ docId: string }>()
  const navigate = useNavigate()
  const { documents, loadingDocuments } = useKbDocuments({ preferZone: "study" })

  const [questionData, setQuestionData] = useState<QuestionListResult | null>(null)
  const [loadingQuestions, setLoadingQuestions] = useState(false)
  const [tagStats, setTagStats] = useState<TagStatsResult | null>(null)
  const [loadingTagStats, setLoadingTagStats] = useState(false)
  const [activeSession, setActiveSession] = useState<QuizSession | null>(null)
  const [filterMode, setFilterMode] = useState<FilterMode>("all")
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const doc = useMemo(() => documents.find((d) => d.id === docId), [documents, docId])

  // 加载题目统计
  const loadQuestionData = useCallback(async () => {
    if (!docId) return
    setLoadingQuestions(true)
    try {
      const res = await questionsApi.list({ document_id: docId })
      setQuestionData(res as QuestionListResult)
    } catch {
      setQuestionData(null)
    } finally {
      setLoadingQuestions(false)
    }
  }, [docId])

  useEffect(() => { loadQuestionData() }, [loadQuestionData])

  // 加载 tag 分析（限定到当前文档）
  useEffect(() => {
    if (!docId) return
    setLoadingTagStats(true)
    analyticsApi.getTagStats(docId)
      .then(setTagStats)
      .catch(() => setTagStats(null))
      .finally(() => setLoadingTagStats(false))
  }, [docId])

  // 检查是否有未完成的会话
  useEffect(() => {
    if (!docId) return
    quizApi.getRecentActiveSession(docId)
      .then((s) => setActiveSession(s as QuizSession | null))
      .catch(() => setActiveSession(null))
  }, [docId])

  const handleStart = async () => {
    if (!docId) return
    setStarting(true)
    setError(null)
    try {
      const res = await quizApi.createSession({ document_id: docId, filter: filterMode })
      const session = res as QuizSession
      navigate(`/quiz/session?session_id=${session.id}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "开始练习失败")
    } finally {
      setStarting(false)
    }
  }

  const handleResume = async () => {
    if (!activeSession) return
    navigate(`/quiz/session?session_id=${activeSession.id}`)
  }

  const stats = useMemo(() => {
    if (!questionData) return null
    return {
      total: questionData.total ?? 0,
      answered: questionData.answered_count ?? 0,
      correct: questionData.correct_count ?? 0,
      wrong: questionData.wrong_count ?? 0,
      unknown: questionData.unknown_count ?? 0,
    }
  }, [questionData])

  const accuracy = stats && stats.answered > 0 ? Math.round((stats.correct / stats.answered) * 100) : null
  const progress = stats && stats.total > 0 ? Math.round((stats.answered / stats.total) * 100) : 0

  if (loadingDocuments) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-20 text-ink-tertiary gap-2">
          <Loader2 className="w-5 h-5 animate-spin" /><span>加载文档...</span>
        </div>
      </AppShell>
    )
  }

  if (!doc) {
    return (
      <AppShell>
        <div className="max-w-4xl mx-auto py-10">
          <Button variant="ghost" size="md" onClick={() => navigate("/quiz")}><ArrowLeft className="w-4 h-4" />返回题库</Button>
          <EmptyState icon={FileText} title="文档不存在" description="未找到该文档，可能已被删除"
            primaryAction={{ label: "返回题库", onClick: () => navigate("/quiz") }} />
        </div>
      </AppShell>
    )
  }

  const hasQuestions = (questionData?.total ?? doc.questionCount ?? 0) > 0
  // Tag 有答题记录的才展示（正确+错误+不会中至少有一个）
  const answeredTags = tagStats?.by_tag?.filter(t => t.total_attempts > 0) ?? []
  const answeredTypes = tagStats?.by_question_type?.filter(t => t.total_attempts > 0) ?? []

  return (
    <AppShell maxWidth={960}>
      {/* 顶部导航 */}
      <div className="flex items-center gap-3 mb-6 short:mb-4">
        <Button variant="ghost" size="md" onClick={() => navigate("/quiz")}>
          <ArrowLeft className="w-4 h-4" />返回
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-body text-danger">{error}</div>
      )}

      {/* ── 上部分：封面 + 统计 + 刷题入口（一屏适配，选择器与按钮同屏可见） ── */}
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)] gap-6 md:gap-8 mb-8 short:mb-6">
        {/* 左侧：封面 */}
        <div className="space-y-3">
          <div className="aspect-[3/4] max-h-[340px] short:max-h-[300px] rounded-xl overflow-hidden border border-line-soft bg-gradient-to-br from-primary-soft/30 to-surface-soft shadow-xs">
            <img src={getThumbnailUrl(doc.id)} alt={doc.name} className="w-full h-full object-cover"
              onError={(e) => {
                const el = e.currentTarget; el.style.display = "none"
                const p = el.parentElement!; p.classList.add("flex", "items-center", "justify-center")
                p.innerHTML = `<div class="flex flex-col items-center gap-2 text-ink-tertiary"><svg class="w-12 h-12" stroke="currentColor" fill="none" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625..."/></svg><span class="text-caption">${doc.name}</span></div>`
              }} />
          </div>
          <div>
            <h1 className="text-card-title font-semibold text-ink-primary mb-1">{doc.name}</h1>
            <div className="flex flex-wrap gap-2">
              <Badge variant={hasQuestions ? "success" : "neutral"} size="sm">
                {hasQuestions ? "可刷题" : doc.question_gen_status === "processing" ? "出题中" : "未出题"}
              </Badge>
              {doc.type && <Badge variant="primary" size="sm">{doc.type.toUpperCase()}</Badge>}
            </div>
          </div>
          {stats && stats.total > 0 && (
            <div className="bg-surface border border-line-soft rounded-lg p-4 text-center">
              <div className="relative w-24 h-24 mx-auto mb-2">
                <svg className="w-24 h-24 -rotate-90" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="52" fill="none" stroke="var(--color-line-soft)" strokeWidth="8" />
                  <circle cx="60" cy="60" r="52" fill="none" stroke="var(--color-primary)" strokeWidth="8"
                    strokeDasharray={`${(progress / 100) * 326.7} 326.7`} strokeLinecap="round" className="transition-all duration-500" />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-card-title font-bold text-primary">{progress}%</span>
                </div>
              </div>
              <div className="text-small text-ink-secondary">已完成 {stats.answered}/{stats.total} 题</div>
            </div>
          )}
        </div>

        {/* 右侧：统计 + 操作 */}
        <div className="space-y-4">
          {loadingQuestions ? (
            <div className="flex items-center gap-2 text-ink-tertiary py-4">
              <Loader2 className="w-4 h-4 animate-spin" /><span className="text-small">加载统计数据...</span>
            </div>
          ) : stats ? (
            <div className="grid grid-cols-2 gap-3">
              <StatCard icon={FileText} label="总题数" value={stats.total} tone="primary" />
              <StatCard icon={CheckCircle2} label="正确" value={stats.correct} tone="success" />
              <StatCard icon={XCircle} label="错误" value={stats.wrong} tone="warning" />
              <StatCard icon={HelpCircle} label="不会" value={stats.unknown} tone="warning" />
            </div>
          ) : <p className="text-body text-ink-tertiary">暂无题目数据</p>}

          {accuracy !== null && (
            <div className="bg-surface-soft rounded-lg px-4 py-3 border border-line-soft">
              <div className="flex items-center gap-2 text-body text-ink-primary">
                <BarChart3 className="w-4 h-4 text-primary" /><span>正确率</span>
                <span className="font-semibold text-primary">{accuracy}%</span>
                <Badge variant={accuracy >= 80 ? "success" : accuracy >= 60 ? "warning" : "neutral"} size="sm">
                  {accuracy >= 80 ? "良好" : accuracy >= 60 ? "待加强" : "需努力"}
                </Badge>
              </div>
            </div>
          )}

          {hasQuestions ? (
            <div className="bg-surface border border-line-soft rounded-lg p-4 space-y-3">
              <div className="text-card-title font-semibold text-ink-primary">开始刷题</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {FILTER_OPTIONS.map((opt) => (
                  <label key={opt.value}
                    className={`flex items-center gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${filterMode === opt.value ? "border-primary bg-primary/5 text-ink-primary" : "border-line-soft hover:border-line text-ink-secondary"}`}>
                    <input type="radio" name="filter" value={opt.value} checked={filterMode === opt.value}
                      onChange={() => setFilterMode(opt.value)} className="accent-primary shrink-0" />
                    <div className="min-w-0"><div className="text-small font-medium">{opt.label}</div><div className="text-caption text-ink-tertiary truncate">{opt.desc}</div></div>
                  </label>
                ))}
              </div>
              {activeSession && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-warning/5 border border-warning/20">
                  <div className="flex items-center gap-2 text-small text-ink-primary">
                    <RefreshCw className="w-4 h-4 text-warning" />
                    <span>有未完成的练习（{activeSession.answered_count}/{activeSession.total_questions} 题已答）</span>
                  </div>
                  <Button variant="secondary" size="sm" onClick={handleResume}>继续</Button>
                </div>
              )}
              <Button variant="primary" size="lg" onClick={handleStart} disabled={starting || loadingQuestions}
                className="w-full" style={{ color: '#FFFFFF' }}>
                {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" strokeWidth={2} />}
                {filterMode === "all" ? "开始刷题" : `开始${FILTER_OPTIONS.find(o => o.value === filterMode)?.label}`}
                <ChevronRight className="w-4 h-4" strokeWidth={2} />
              </Button>
            </div>
          ) : (
            <div className="bg-surface border border-line-soft rounded-lg p-5 text-center">
              {doc.question_gen_status === "processing" ? (
                <div className="flex items-center justify-center gap-2 text-ink-tertiary">
                  <Loader2 className="w-4 h-4 animate-spin" /><span>文档正在出题中，请稍后再来</span>
                </div>
              ) : <p className="text-body text-ink-tertiary">该文档暂无题目</p>}
              <Button variant="secondary" size="md" className="mt-3" onClick={() => navigate(`/question-gen/doc/${doc.id}`)}>去出题</Button>
            </div>
          )}
        </div>
      </div>

      {/* ── 下部分：Tag 分析统计 ── */}
      {hasQuestions && answeredTags.length > 0 ? (
        <div className="space-y-6 border-t border-line-soft pt-8">
          <SectionHeader title="知识点分析" subtitle="按 Tag 和题型聚合的答题统计" />

          {loadingTagStats ? (
            <div className="flex items-center gap-2 text-ink-tertiary">
              <Loader2 className="w-4 h-4 animate-spin" /><span className="text-small">加载 Tag 分析...</span>
            </div>
          ) : (
            <>
              {/* 按 Tag */}
              <div>
                <h3 className="text-card-title font-semibold text-ink-primary mb-4">按知识点</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {answeredTags.map((t) => {
                    const acc = t.accuracy_rate
                    const total = t.correct_count + t.wrong_count + t.unknown_count
                    return (
                      <Card key={t.tag} className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <span className="text-body font-medium text-ink-primary">{t.tag}</span>
                          <Badge variant={acc != null && acc >= 80 ? "success" : acc != null && acc >= 60 ? "warning" : "neutral"} size="sm">
                            {acc != null ? `${acc}%` : "—"}
                          </Badge>
                        </div>
                        <div className="flex gap-3 text-small text-ink-secondary">
                          <span className="text-success">✓ {t.correct_count}</span>
                          <span className="text-danger">✗ {t.wrong_count}</span>
                          <span className="text-warning">? {t.unknown_count}</span>
                          <span className="text-ink-tertiary">共 {total} 次</span>
                        </div>
                      </Card>
                    )
                  })}
                </div>
              </div>

              {/* 按题型 */}
              {answeredTypes.length > 0 && (
                <div>
                  <h3 className="text-card-title font-semibold text-ink-primary mb-4">按题型</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {answeredTypes.map((t) => {
                      const acc = t.accuracy_rate
                      const total = t.correct_count + t.wrong_count + t.unknown_count
                      const typeLabel: Record<string, string> = { single_choice: "单选题", multiple_choice: "多选题", fill_blank: "填空题", short_answer: "简答题", application: "应用题" }
                      return (
                        <Card key={t.question_type} className="p-4">
                          <div className="flex items-start justify-between mb-2">
                            <span className="text-body font-medium text-ink-primary">{typeLabel[t.question_type] || t.question_type}</span>
                            <Badge variant={acc != null && acc >= 80 ? "success" : acc != null && acc >= 60 ? "warning" : "neutral"} size="sm">
                              {acc != null ? `${acc}%` : "—"}
                            </Badge>
                          </div>
                          <div className="flex gap-3 text-small text-ink-secondary">
                            <span className="text-success">✓ {t.correct_count}</span>
                            <span className="text-danger">✗ {t.wrong_count}</span>
                            <span className="text-warning">? {t.unknown_count}</span>
                            <span className="text-ink-tertiary">共 {total} 次</span>
                          </div>
                        </Card>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : hasQuestions && !loadingTagStats ? (
        <div className="border-t border-line-soft pt-8">
          <SectionHeader title="知识点分析" subtitle="暂无答题记录，完成刷题后在此查看" />
        </div>
      ) : null}
    </AppShell>
  )
}