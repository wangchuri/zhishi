import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Flame,
  HelpCircle,
  Loader2,
  Play,
  XCircle,
  RefreshCw,
  BarChart3,
  ListTree,
  ListChecks,
  PenLine,
} from "lucide-react"
import { AppShell } from "@/components/layout/AppShell"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { StatCard } from "@/components/ui/stat-card"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { SectionHeader } from "@/components/blocks/SectionHeader"
import { QuizQuestionPreviewDialog } from "./QuizQuestionPreviewDialog"
import { QuestionGenJobsBanner } from "./QuestionGenJobsBanner"
import { questionsApi, quizApi, analyticsApi, kbApi, getThumbnailUrl } from "@/lib/api"
import { accuracyPercent, formatAccuracy, splitTagLabels } from "@/lib/utils"
import { useKbDocuments } from "@/hooks/useKbDocuments"
import type { LearningPathChapter, LearningPathResult, Question, QuestionGenJob, QuestionListResult, QuizSession, TagStatsResult } from "@/types"
import { toast } from "sonner"

type FilterMode = "all" | "undone" | "wrong" | "unknown"

const FILTER_OPTIONS: { value: FilterMode; label: string; desc: string }[] = [
  { value: "all", label: "从头开始", desc: "全部题目随机顺序" },
  { value: "undone", label: "只做未做题", desc: "过滤已答过的题目" },
  { value: "wrong", label: "只做错题", desc: "过滤答错的题目" },
  { value: "unknown", label: "只做不会题", desc: "过滤标记为不会的题目" },
]

const TYPE_LABEL: Record<string, string> = {
  single_choice: "单选题",
  multiple_choice: "多选题",
  fill_blank: "填空题",
  short_answer: "简答题",
  application: "应用题",
  custom: "自定义题",
}

function splitKeyPoints(points: string[] | undefined): string[] {
  const out: string[] = []
  for (const raw of points || []) {
    const s = String(raw).trim()
    if (!s) continue
    const parts: string[] = []
    let buf = ""
    let depth = 0
    for (const ch of s) {
      if (ch === "（" || ch === "(") {
        depth += 1
        buf += ch
      } else if (ch === "）" || ch === ")") {
        depth = Math.max(0, depth - 1)
        buf += ch
      } else if (depth === 0 && /[、，,;；]/.test(ch)) {
        const t = buf.trim()
        if (t) parts.push(t)
        buf = ""
      } else {
        buf += ch
      }
    }
    const last = buf.trim()
    if (last) parts.push(last)
    out.push(...parts)
  }
  return out
}

function matchesFilter(q: Question, mode: FilterMode): boolean {
  if (mode === "undone") return !(q.attempt_count && q.attempt_count > 0)
  if (mode === "wrong") return q.user_answer_status === "wrong"
  if (mode === "unknown") return q.user_answer_status === "unknown"
  return true
}

export function QuizDocDetailPage() {
  const { docId } = useParams<{ docId: string }>()
  const navigate = useNavigate()
  const { documents, loadingDocuments, updateDocument } = useKbDocuments({ preferZone: "study" })

  const [questionData, setQuestionData] = useState<QuestionListResult | null>(null)
  const [loadingQuestions, setLoadingQuestions] = useState(false)
  const [tagStats, setTagStats] = useState<TagStatsResult | null>(null)
  const [loadingTagStats, setLoadingTagStats] = useState(false)
  const [activeSession, setActiveSession] = useState<QuizSession | null>(null)
  const [filterMode, setFilterMode] = useState<FilterMode>("all")
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [learningPath, setLearningPath] = useState<LearningPathResult | null>(null)
  const [loadingPath, setLoadingPath] = useState(false)
  const [generatingPath, setGeneratingPath] = useState(false)
  const pathPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [genJobs, setGenJobs] = useState<QuestionGenJob[]>([])
  const [expandedChapter, setExpandedChapter] = useState<number | null>(null)
  const [startingChapter, setStartingChapter] = useState<string | null>(null)
  const wasGeneratingRef = useRef(false)

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

  useEffect(() => {
    if (!docId) return
    let cancelled = false
    const tick = async () => {
      try {
        const res = await questionsApi.listJobs()
        if (cancelled) return
        const jobs = (res.jobs || []).filter((j) => j.document_id === docId)
        setGenJobs(jobs)
        const running = jobs.length > 0
        if (running) {
          wasGeneratingRef.current = true
          updateDocument(docId, { question_gen_status: "processing" })
        } else if (wasGeneratingRef.current) {
          wasGeneratingRef.current = false
          updateDocument(docId, { question_gen_status: "completed" })
          void loadQuestionData()
        }
      } catch {
        if (!cancelled) setGenJobs([])
      }
    }
    void tick()
    const timer = window.setInterval(tick, 2500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [docId, loadQuestionData, updateDocument])

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

  const stopPathPoll = () => {
    if (pathPollRef.current) {
      clearInterval(pathPollRef.current)
      pathPollRef.current = null
    }
  }

  const handleGeneratePath = async () => {
    if (!docId || generatingPath) return
    setGeneratingPath(true)
    try {
      const res = await kbApi.generateLearningPath(docId)
      setLearningPath(res)
    } catch (err: unknown) {
      setGeneratingPath(false)
      toast.error(err instanceof Error ? err.message : "提取目录失败")
    }
  }

  useEffect(() => {
    if (!docId) return
    let cancelled = false
    setLearningPath(null)
    setGeneratingPath(false)
    setLoadingPath(true)

    const run = async () => {
      try {
        const res = await kbApi.getLearningPath(docId)
        if (cancelled) return
        setLearningPath(res)
        if (!res.chapters?.length) {
          setGeneratingPath(true)
          try {
            const started = await kbApi.generateLearningPath(docId)
            if (!cancelled) setLearningPath(started)
          } catch {
            if (!cancelled) setGeneratingPath(false)
          }
        }
      } catch {
        if (!cancelled) setLearningPath(null)
      } finally {
        if (!cancelled) setLoadingPath(false)
      }
    }
    void run()
    return () => {
      cancelled = true
      stopPathPoll()
    }
  }, [docId])

  useEffect(() => {
    const pending = generatingPath || learningPath?.status === "pending"
    const hasChapters = (learningPath?.chapters?.length ?? 0) > 0
    if (!docId || !pending || hasChapters) {
      if (hasChapters) setGeneratingPath(false)
      return
    }
    stopPathPoll()
    pathPollRef.current = setInterval(() => {
      kbApi.getLearningPath(docId)
        .then((res) => {
          setLearningPath(res)
          if (res.chapters?.length || res.status === "generated" || res.status === "failed") {
            stopPathPoll()
            setGeneratingPath(false)
          }
        })
        .catch(() => {})
    }, 3000)
    return () => stopPathPoll()
  }, [docId, generatingPath, learningPath?.status, learningPath?.chapters?.length])

  const questionsByChapter = useMemo(() => {
    const map = new Map<string, Question[]>()
    for (const q of questionData?.questions || []) {
      const cid = (q.chapter_id || "").trim()
      if (!cid) continue
      const list = map.get(cid) || []
      if (!list.some((item) => item.id === q.id)) list.push(q)
      map.set(cid, list)
    }
    return map
  }, [questionData])

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

  const handleStartChapter = async (ch: LearningPathChapter) => {
    if (!docId || !ch.id) return
    const ids = (questionsByChapter.get(ch.id) || [])
      .filter((q) => matchesFilter(q, filterMode))
      .map((q) => q.id)
    if (!ids.length) {
      toast.error(filterMode === "all" ? "这一章还没有题目" : "这一章没有符合筛选的题目")
      return
    }
    setStartingChapter(ch.id)
    setError(null)
    try {
      const res = await quizApi.createSession({
        document_id: docId,
        question_ids: ids,
        title: ch.title || "本章练习",
      })
      const session = res as QuizSession
      navigate(`/quiz/session?session_id=${session.id}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "开始练习失败")
    } finally {
      setStartingChapter(null)
    }
  }

  const handleResume = async () => {
    if (!activeSession) return
    navigate(`/quiz/session?session_id=${activeSession.id}`)
  }

  const [exporting, setExporting] = useState(false)
  const handleExport = async () => {
    if (!docId || exporting) return
    setExporting(true)
    try {
      await kbApi.exportPackage(docId, doc?.name)
      toast.success("书本包已下载，可分享给其他用户导入")
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "导出失败")
    } finally {
      setExporting(false)
    }
  }

  const stats = useMemo(() => {
    if (!questionData) return null
    return {
      total: questionData.total ?? 0,
      answered: questionData.answered_count ?? 0,
      correct: questionData.correct_count ?? 0,
      wrong: questionData.wrong_count ?? 0,
      unknown: questionData.unknown_count ?? 0,
      bestStreak: questionData.best_streak ?? 0,
    }
  }, [questionData])

  const tocKeyPoints = useMemo(() => {
    const seen = new Set<string>()
    const points: string[] = []
    for (const ch of learningPath?.chapters || []) {
      for (const p of splitKeyPoints(ch.key_points)) {
        if (seen.has(p)) continue
        seen.add(p)
        points.push(p)
      }
    }
    return points
  }, [learningPath])

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
          <Button variant="ghost" size="md" onClick={() => navigate("/quiz")}><ArrowLeft className="w-4 h-4" />返回资料</Button>
          <EmptyState icon={FileText} title="文档不存在" description="未找到该文档，可能已被删除"
            primaryAction={{ label: "返回资料", onClick: () => navigate("/quiz") }} />
        </div>
      </AppShell>
    )
  }

  const hasQuestions = (questionData?.total ?? doc.questionCount ?? 0) > 0
  const allTags = tagStats?.by_tag ?? []
  const answeredTags = allTags.filter(t => t.total_attempts > 0)
  const questionTagLabels = [...new Set(allTags.flatMap((t) => splitTagLabels(t.tag)))]
  const typeStats = tagStats?.by_question_type ?? []

  return (
    <AppShell maxWidth={1100}>
      {/* 顶部导航 */}
      <div className="flex items-center gap-3 mb-6 short:mb-4">
        <Button variant="ghost" size="md" onClick={() => navigate("/quiz")}>
          <ArrowLeft className="w-4 h-4" />返回
        </Button>
        <div className="flex-1" />
        <Button variant="secondary" size="md" onClick={() => navigate(`/companion/doc/${doc.id}`)}>
          <BookOpen className="w-4 h-4 mr-2" />
          阅读
        </Button>
        <Button variant="secondary" size="md" onClick={() => navigate(`/knowledge/doc/${doc.id}?title=${encodeURIComponent(doc.name)}`)}>
          查看原文
        </Button>
        <Button variant="secondary" size="md" onClick={() => setPreviewOpen(true)} disabled={!hasQuestions && !loadingQuestions}>
          <ListChecks className="w-4 h-4 mr-2" />
          查看题目
        </Button>
        <Button variant="secondary" size="md" onClick={() => navigate(`/question-gen/doc/${doc.id}`)}>
          <PenLine className="w-4 h-4 mr-2" />
          出题
        </Button>
        <Button variant="secondary" size="md" onClick={handleExport} disabled={exporting}>
          {exporting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Download className="w-4 h-4 mr-2" />}
          导出题库
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-body text-danger">{error}</div>
      )}
      {genJobs.length > 0 && (
        <div className="mb-4">
          <QuestionGenJobsBanner jobs={genJobs} />
        </div>
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
              <Badge
                variant={
                  (doc.question_gen_status === "processing" || genJobs.length > 0)
                    ? "warning"
                    : hasQuestions
                      ? "success"
                      : "neutral"
                }
                size="sm"
              >
                {(doc.question_gen_status === "processing" || genJobs.length > 0)
                  ? "出题中"
                  : hasQuestions
                    ? "可刷题"
                    : "未出题"}
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
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                className="text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <StatCard icon={FileText} label="总题数" value={stats.total} hint="点击查看题目" tone="primary" />
              </button>
              <StatCard icon={CheckCircle2} label="正确" value={stats.correct} tone="success" />
              <StatCard icon={XCircle} label="错误" value={stats.wrong} tone="warning" />
              <StatCard icon={HelpCircle} label="不会" value={stats.unknown} tone="warning" />
              <StatCard icon={Flame} label="最高连对" value={stats.bestStreak} tone="warning" />
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
              <Button variant="primary" size="lg" onClick={handleStart} disabled={starting || loadingQuestions || startingChapter !== null}
                className="w-full" style={{ color: '#FFFFFF' }}>
                {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" strokeWidth={2} />}
                {filterMode === "all" ? "开始刷题" : `开始${FILTER_OPTIONS.find(o => o.value === filterMode)?.label}`}
                <ChevronRight className="w-4 h-4" strokeWidth={2} />
              </Button>
            </div>
          ) : (
            <div className="bg-surface border border-line-soft rounded-lg p-5 text-center">
              {doc.question_gen_status === "processing" || genJobs.length > 0 ? (
                <div className="flex items-center justify-center gap-2 text-ink-tertiary">
                  <Loader2 className="w-4 h-4 animate-spin" /><span>文档正在出题中，请稍后再来</span>
                </div>
              ) : <p className="text-body text-ink-tertiary">该文档暂无题目</p>}
              <Button variant="secondary" size="md" className="mt-3" onClick={() => navigate(`/question-gen/doc/${doc.id}`)}>出题</Button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8 short:mb-6">
        <div className="min-w-0 flex flex-col">
          <SectionHeader
            title="书本目录"
            subtitle={learningPath?.title ? `「${learningPath.title}」· 点开看要点，可刷这一章` : "点开看要点，可刷这一章"}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleGeneratePath()}
              disabled={generatingPath || loadingPath}
            >
              {generatingPath ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {generatingPath ? "提取中" : "重新提取"}
            </Button>
          </SectionHeader>

          {loadingPath && !learningPath ? (
            <Card className="p-6 flex items-center justify-center gap-2 text-ink-tertiary">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-small">加载目录...</span>
            </Card>
          ) : (learningPath?.chapters?.length ?? 0) > 0 ? (
            <Card className="overflow-hidden">
              <div className="max-h-[420px] overflow-y-auto divide-y divide-line-soft">
                {learningPath!.chapters.map((ch, i) => {
                  const points = splitKeyPoints(ch.key_points)
                  const open = expandedChapter === i
                  const chapterQs = ch.id ? questionsByChapter.get(ch.id) || [] : []
                  const filteredCount = chapterQs.filter((q) => matchesFilter(q, filterMode)).length
                  const quizBusy = starting || startingChapter !== null
                  return (
                    <div key={`${ch.id || ch.order}-${ch.title}-${i}`} className="hover:bg-surface-soft/80 transition-colors">
                      <div className="flex items-center gap-1 pr-2">
                        <button
                          type="button"
                          onClick={() => setExpandedChapter(open ? null : i)}
                          className="flex-1 min-w-0 px-3 py-2 text-left"
                        >
                          <div className="flex items-center gap-2.5">
                            <div className="w-6 h-6 rounded-[4px] bg-sea-subtle text-sea flex items-center justify-center shrink-0 text-caption font-semibold">
                              {ch.order || i + 1}
                            </div>
                            <div className="min-w-0 flex-1 text-small font-medium text-ink-primary truncate">
                              {ch.title || `第 ${ch.order || i + 1} 章`}
                            </div>
                            <span className="text-caption text-ink-tertiary shrink-0">
                              {chapterQs.length} 题
                              {points.length > 0 ? ` · ${points.length} 点` : ""}
                            </span>
                            {open ? (
                              <ChevronDown className="w-4 h-4 text-ink-tertiary shrink-0" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-ink-tertiary shrink-0" />
                            )}
                          </div>
                        </button>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="shrink-0"
                          disabled={!ch.id || quizBusy || filteredCount === 0}
                          title={!ch.id ? "目录缺少章节 id" : filteredCount === 0 ? "这一章还没有可刷的题目" : "刷这一章"}
                          onClick={() => void handleStartChapter(ch)}
                        >
                          {startingChapter === ch.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Play className="w-3.5 h-3.5" strokeWidth={2} />
                          )}
                          刷这一章
                        </Button>
                      </div>
                      {points.length > 0 && (
                        open ? (
                          <div className="px-3 pb-2 pl-11 flex flex-wrap gap-1.5">
                            {points.map((p, pi) => (
                              <Badge
                                key={`${pi}-${p}`}
                                variant="neutral"
                                size="sm"
                                className="whitespace-normal break-words h-auto py-0.5 max-w-full"
                              >
                                {p}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <div className="px-3 pb-2 pl-11 min-w-0">
                            <div className="rounded-full bg-paper-2 text-ink-soft border border-line-light px-2.5 py-0.5 text-caption truncate">
                              {points.join("、")}
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  )
                })}
              </div>
            </Card>
          ) : (
            <Card className="p-6">
              <EmptyState
                icon={ListTree}
                title={generatingPath || learningPath?.status === "pending" ? "正在提取目录" : "还没有书本目录"}
                description={
                  generatingPath || learningPath?.status === "pending"
                    ? "Agent 正在梳理章节，完成后会显示在这里。"
                    : "可以点「重新提取」，或先确认文档已解析完成。"
                }
                size="sm"
              />
            </Card>
          )}
        </div>

        <div className="min-w-0 flex flex-col">
          <SectionHeader
            title="知识点"
            subtitle={
              questionTagLabels.length > 0
                ? "目录要点与题目标签"
                : "来自书本目录的要点"
            }
          />
          <Card className="p-4 max-h-[420px] overflow-y-auto">
            {tocKeyPoints.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {tocKeyPoints.map((p, i) => (
                  <Badge key={`${i}-${p}`} variant="neutral" size="sm" className="whitespace-normal break-words h-auto py-0.5 max-w-full">{p}</Badge>
                ))}
              </div>
            )}
            {questionTagLabels.length > 0 && (
              <div className={tocKeyPoints.length > 0 ? "pt-3 border-t border-line-soft" : ""}>
                {tocKeyPoints.length > 0 && (
                  <div className="text-caption font-medium text-ink-secondary mb-2">题目标签</div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {questionTagLabels.map((label) => (
                    <Badge key={label} variant="primary" size="sm">{label}</Badge>
                  ))}
                </div>
              </div>
            )}
            {tocKeyPoints.length === 0 && questionTagLabels.length === 0 && (
              <p className="text-small text-ink-tertiary">
                {hasQuestions ? "题目还没有可用的知识点标签。" : "提取目录后会在这里列出知识点。"}
              </p>
            )}
          </Card>
        </div>
      </div>

      {hasQuestions && (
        <div className="space-y-6 border-t border-line-soft pt-8 mb-8">
          <SectionHeader
            title="知识点 Tag 统计"
            subtitle={
              answeredTags.length > 0
                ? "按 Tag 和题型聚合的答题统计"
                : "出题后即可看到标签；刷题后会显示对错与正确率"
            }
          />
          {loadingTagStats ? (
            <div className="flex items-center gap-2 text-ink-tertiary">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-small">加载 Tag 分析...</span>
            </div>
          ) : allTags.length > 0 ? (
            <>
              <div>
                <h3 className="text-card-title font-semibold text-ink-primary mb-4">按知识点</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {allTags.map((t) => {
                    const acc = accuracyPercent(t.accuracy_rate)
                    const attempted = t.total_attempts > 0
                    return (
                      <Card key={t.tag} className="p-4">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <span className="flex flex-wrap gap-1 min-w-0">
                            {splitTagLabels(t.tag).map((label) => (
                              <span key={label} className="text-body font-medium text-ink-primary">
                                {label}
                              </span>
                            ))}
                          </span>
                          <Badge
                            variant={
                              !attempted
                                ? "neutral"
                                : acc != null && acc >= 80
                                  ? "success"
                                  : acc != null && acc >= 60
                                    ? "warning"
                                    : "neutral"
                            }
                            size="sm"
                          >
                            {attempted ? formatAccuracy(t.accuracy_rate) : "未作答"}
                          </Badge>
                        </div>
                        <div className="flex gap-3 text-small text-ink-secondary">
                          <span className="text-success">✓ {t.correct_count}</span>
                          <span className="text-danger">✗ {t.wrong_count}</span>
                          <span className="text-warning">? {t.unknown_count}</span>
                          <span className="text-ink-tertiary">共 {t.total_attempts} 次</span>
                        </div>
                      </Card>
                    )
                  })}
                </div>
              </div>
              {typeStats.length > 0 && (
                <div>
                  <h3 className="text-card-title font-semibold text-ink-primary mb-4">按题型</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {typeStats.map((t) => {
                      const acc = accuracyPercent(t.accuracy_rate)
                      const attempted = t.total_attempts > 0
                      return (
                        <Card key={t.question_type} className="p-4">
                          <div className="flex items-start justify-between mb-2">
                            <span className="text-body font-medium text-ink-primary">
                              {TYPE_LABEL[t.question_type] || t.question_type}
                            </span>
                            <Badge
                              variant={
                                !attempted
                                  ? "neutral"
                                  : acc != null && acc >= 80
                                    ? "success"
                                    : acc != null && acc >= 60
                                      ? "warning"
                                      : "neutral"
                              }
                              size="sm"
                            >
                              {attempted ? formatAccuracy(t.accuracy_rate) : "未作答"}
                            </Badge>
                          </div>
                          <div className="flex gap-3 text-small text-ink-secondary">
                            <span className="text-success">✓ {t.correct_count}</span>
                            <span className="text-danger">✗ {t.wrong_count}</span>
                            <span className="text-warning">? {t.unknown_count}</span>
                            <span className="text-ink-tertiary">共 {t.total_attempts} 次</span>
                          </div>
                        </Card>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-small text-ink-tertiary">题目还没有知识点标签，重新出题后会出现在这里。</p>
          )}
        </div>
      )}

      <QuizQuestionPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        documentId={doc.id}
        documentName={doc.name}
        questions={questionData?.questions || []}
        loading={loadingQuestions}
      />
    </AppShell>
  )
}