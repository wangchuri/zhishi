import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  ChevronLeft,
  FileText,
  HelpCircle,
  Loader2,
  Play,
  Trash2,
} from "lucide-react"
import { AppShell } from "@/components/layout/AppShell"
import { PageHeader } from "@/components/blocks/PageHeader"
import { KbDocBrowser } from "@/components/blocks/KbDocBrowser"
import { DocumentPipelineBadge } from "@/components/blocks/DocumentPipelineBadge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { StatCard } from "@/components/ui/stat-card"
import { questionsApi, quizApi } from "@/lib/api"
import { useKbDocuments } from "@/hooks/useKbDocuments"
import type {
  KnowledgeDoc,
  Question,
  QuestionListResult,
  QuizAnswerResult,
  QuizReviewItem,
  QuizSession,
} from "@/types"
import { QuizReviewPanel } from "./QuizReviewPanel"
import { QuizQuestionInput } from "./QuizQuestionInput"
import { QuizAnswerFeedback, getSubmitButtonLabel } from "./QuizAnswerFeedback"
import {
  QUESTION_TYPE_LABEL,
  buildUserAnswerPayload,
  canSubmitAnswer,
  getBlankCount,
} from "./quizQuestionUtils"
import { TutorPanel, type TutorPanelHandle } from "@/features/tutor/TutorPanel"
import { MarkdownWithMath } from "@/components/blocks/MarkdownWithMath"

type Phase = "setup" | "quiz" | "done"

function QuestionStatusBadge({
  status,
  attemptCount = 0,
}: {
  status?: Question["user_answer_status"]
  attemptCount?: number
}) {
  if (!attemptCount) {
    return <Badge variant="neutral" size="sm">未做</Badge>
  }
  const statusMap = {
    correct: { label: "正确", variant: "success" as const },
    wrong: { label: "错误", variant: "danger" as const },
    unknown: { label: "不会", variant: "warning" as const },
  }
  const info = status
    ? statusMap[status]
    : { label: "已做", variant: "neutral" as const }
  return (
    <Badge variant={info.variant} size="sm" title={`练习 ${attemptCount} 次`}>
      {info.label}
      {attemptCount > 1 ? ` ×${attemptCount}` : ""}
    </Badge>
  )
}

export function QuizPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const {
    collections,
    selectedCollectionId,
    setSelectedCollectionId,
    selectedCollection,
    documents,
    setDocuments,
    loadingCollections,
    loadingDocuments,
    refreshDocuments,
    updateDocument,
  } = useKbDocuments({ preferZone: "study" })

  const [selectedDocumentId, setSelectedDocumentId] = useState("")
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [setupAlert, setSetupAlert] = useState<string | null>(null)
  const [genAlertDocName, setGenAlertDocName] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tutorPanelRef = useRef<TutorPanelHandle>(null)

  const [phase, setPhase] = useState<Phase>("setup")
  const [session, setSession] = useState<QuizSession | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [selectedOption, setSelectedOption] = useState<string | null>(null)
  const [textAnswer, setTextAnswer] = useState("")
  const [blankAnswers, setBlankAnswers] = useState<string[]>([])
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [lastResult, setLastResult] = useState<QuizAnswerResult | null>(null)
  const [reviewItems, setReviewItems] = useState<QuizReviewItem[]>([])
  const [resultsSummary, setResultsSummary] = useState<{
    correct: number
    wrong: number
    unknown: number
  } | null>(null)
  const [questionListData, setQuestionListData] = useState<QuestionListResult | null>(null)
  const [loadingQuestions, setLoadingQuestions] = useState(false)
  const [loadingSession, setLoadingSession] = useState(false)
  const [questionStartTime, setQuestionStartTime] = useState(Date.now())
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingQuestions, setDeletingQuestions] = useState(false)

  // 如果 URL 中有 session_id，直接加载该会话（从 /quiz/doc/:docId 跳转过来）
  const sessionIdFromUrl = searchParams.get("session_id")
  useEffect(() => {
    if (!sessionIdFromUrl) return
    setLoadingSession(true)
    quizApi
      .getSession(sessionIdFromUrl)
      .then((res) => {
        const s = res as unknown as QuizSession
        setSession(s)
        setCurrentIndex(s.answered_count) // 跳转到已答位置
        setPhase("quiz")
      })
      .catch(() => {
        setSetupAlert("会话加载失败，请重新选择资料开始练习")
      })
      .finally(() => setLoadingSession(false))
  }, [sessionIdFromUrl])

  const selectedDocument = documents.find((d) => d.id === selectedDocumentId)
  const isLifeZone = selectedCollection?.zone === "life"

  const fetchQuestionCount = useCallback(async (documentId: string) => {
    try {
      const res = await questionsApi.list({ document_id: documentId })
      const items = res.questions || res.data || []
      return Array.isArray(items) ? items.length : 0
    } catch {
      return 0
    }
  }, [])

  const loadQuestionList = useCallback(async (documentId: string) => {
    setLoadingQuestions(true)
    try {
      const res = (await questionsApi.list({ document_id: documentId })) as QuestionListResult
      const items = res.questions || []
      const data: QuestionListResult = {
        ...res,
        questions: Array.isArray(items) ? items : [],
        total: res.total ?? (Array.isArray(items) ? items.length : 0),
      }
      setQuestionListData(data)
      return data
    } catch {
      setQuestionListData(null)
      return null
    } finally {
      setLoadingQuestions(false)
    }
  }, [])

  useEffect(() => {
    if (loadingDocuments || documents.length === 0 || selectedCollection?.zone === "life") return
    if (!documents.some((d) => d.questionCount === undefined)) return

    let cancelled = false
    ;(async () => {
      const enriched = await Promise.all(
        documents.map(async (d) => ({
          ...d,
          questionCount: d.zone === "life" ? 0 : await fetchQuestionCount(d.id),
        }))
      )
      if (!cancelled) setDocuments(enriched)
    })()

    return () => {
      cancelled = true
    }
  }, [loadingDocuments, documents, selectedCollection?.zone, fetchQuestionCount, setDocuments])

  useEffect(() => {
    if (documents.length === 0) {
      setSelectedDocumentId("")
      return
    }
    const urlDocId = searchParams.get("document_id")
    if (urlDocId && documents.some((d) => d.id === urlDocId)) {
      setSelectedDocumentId(urlDocId)
    }
  }, [documents, searchParams])

  useEffect(() => {
    if (!selectedDocumentId || isLifeZone) {
      setQuestionListData(null)
      return
    }
    loadQuestionList(selectedDocumentId)
  }, [selectedDocumentId, isLifeZone, loadQuestionList])

  // ── 轮询文档出题状态，显示顶部横幅 ──
  const generatingDoc = useMemo(() => {
    if (!documents) return null
    return documents.find(
      (d) => d.question_gen_status === "processing" && d.zone !== "life"
    ) ?? null
  }, [documents])

  useEffect(() => {
    if (generatingDoc) {
      setGenAlertDocName(generatingDoc.name)
    } else {
      setGenAlertDocName(null)
    }
  }, [generatingDoc])

  useEffect(() => {
    const timer = window.setInterval(async () => {
      try {
        const docs = await refreshDocuments(true)
        const gen = docs.find(
          (d: any) => d.question_gen_status === "processing" && d.zone !== "life"
        )
        setGenAlertDocName(gen?.name ?? null)
      } catch {
        /* ignore */
      }
    }, 5000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const handleDocumentSelect = (doc: KnowledgeDoc) => {
    setSelectedDocumentId(doc.id)
    setSetupAlert(null)
    setError(null)
  }

  const handleCollectionChange = (id: string) => {
    setSelectedCollectionId(id)
    setSelectedDocumentId("")
    setSetupAlert(null)
  }

  const currentQuestion = session?.questions[currentIndex]

  const isSessionExpiredError = (msg: string) =>
    msg.includes("刷题会话不存在") || msg.includes("会话已结束")

  const handleSessionExpired = () => {
    setSession(null)
    setPhase("setup")
    setSetupAlert("练习会话已失效（可能因后端重启或数据变更），请重新选择资料并开始练习。")
  }

  const addReviewItem = useCallback(
    (result: QuizAnswerResult, stem: string, userAnswer?: string) => {
      if (result.status !== "wrong" && result.status !== "unknown" && result.status !== "partial") return
      const item: QuizReviewItem = {
        question_id: result.question_id,
        stem,
        user_answer: userAnswer ?? (result.status === "unknown" ? "我不会" : selectedOption),
        status: result.status,
        correct_answer: result.correct_answer || "—",
        explanation: result.explanation,
        citation: result.citation,
      }
      setReviewItems((prev) => {
        if (prev.some((x) => x.question_id === item.question_id)) {
          return prev.map((x) => (x.question_id === item.question_id ? item : x))
        }
        return [...prev, item]
      })
    },
    [selectedOption]
  )

  useEffect(() => {
    if (!currentQuestion) return
    if (currentQuestion.question_type === "fill_blank") {
      setBlankAnswers(Array.from({ length: getBlankCount(currentQuestion) }, () => ""))
    } else {
      setBlankAnswers([])
    }
    setTextAnswer("")
    setSelectedOption(null)
    setCustomAnswers({})
  }, [currentQuestion?.question_id])

  const docReadyForQuiz =
    selectedDocument &&
    selectedDocument.question_gen_status === "completed" &&
    (selectedDocument.questionCount ?? 0) > 0

  const canStartQuiz =
    !starting &&
    !isLifeZone &&
    !!selectedDocumentId &&
    !!docReadyForQuiz

  const handleStart = async () => {
    if (!selectedDocumentId) {
      setError("请先选择一份学习资料")
      return
    }
    if (isLifeZone || selectedDocument?.zone === "life") {
      setSetupAlert("生活区文档仅支持检索与对话，请切换到学习区。")
      return
    }
    if (!docReadyForQuiz) {
      setSetupAlert("所选文档尚无可用题目，请先完成出题。")
      return
    }
    setStarting(true)
    setError(null)
    setSetupAlert(null)
    try {
      const res = await quizApi.createSession({ document_id: selectedDocumentId })
      const s = res as unknown as QuizSession
      setSession(s)
      setCurrentIndex(0)
      setSelectedOption(null)
      setTextAnswer("")
      setBlankAnswers([])
      setLastResult(null)
      setReviewItems([])
      setResultsSummary(null)
      setQuestionStartTime(Date.now())
      setPhase("quiz")
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "创建练习会话失败"
      if (msg.includes("尚未出题") || msg.includes("没有可用题目") || msg.includes("409")) {
        setSetupAlert(msg)
      } else {
        setError(msg)
      }
    } finally {
      setStarting(false)
    }
  }

  const handleDeleteQuestions = async () => {
    if (!selectedDocumentId) return
    setDeletingQuestions(true)
    setError(null)
    try {
      const res = await questionsApi.deleteByDocument(selectedDocumentId)
      setQuestionListData(null)
      updateDocument(selectedDocumentId, { questionCount: 0 })
      setSetupAlert(
        res.deleted_count > 0
          ? `已删除 ${res.deleted_count} 道题目的题库引用，答题历史记录已保留。`
          : "该文档暂无题库引用。"
      )
      setDeleteDialogOpen(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "删除题库失败")
    } finally {
      setDeletingQuestions(false)
    }
  }

  const canDeleteQuestions =
    !deletingQuestions &&
    !isLifeZone &&
    !!selectedDocumentId &&
    (questionListData?.total ?? selectedDocument?.questionCount ?? 0) > 0

  const finishSession = async (sessionId: string) => {
    try {
      const res = await quizApi.getResults(sessionId)
      setResultsSummary({
        correct: Number(res.correct_count) || 0,
        wrong: Number(res.wrong_count) || 0,
        unknown: Number(res.unknown_count) || 0,
      })
      const items = (res.items || []) as QuizReviewItem[]
      if (items.length > 0) setReviewItems(items)
    } catch {
      /* ignore */
    }
    setPhase("done")
    if (selectedDocumentId) loadQuestionList(selectedDocumentId)
  }

  const advanceOrFinish = async (result: QuizAnswerResult) => {
    if (!session) return
    const nextIndex = currentIndex + 1
    if (result.session_status === "completed" || nextIndex >= session.total_questions) {
      await finishSession(session.id)
      return
    }
    setCurrentIndex(nextIndex)
    setSelectedOption(null)
    setTextAnswer("")
    setBlankAnswers([])
    setLastResult(null)
    setReviewItems([])
    setQuestionStartTime(Date.now())
  }

  const submitAnswerCore = async (opts?: { requestAiGrade?: boolean }) => {
    if (!session || !currentQuestion || submitting) return
    const qtype = currentQuestion.question_type || "single_choice"
    const payload = buildUserAnswerPayload(qtype, selectedOption, textAnswer, blankAnswers, customAnswers)
    if (!opts?.requestAiGrade && !canSubmitAnswer(qtype, selectedOption, textAnswer, blankAnswers, customAnswers)) {
      return
    }

    setSubmitting(true)
    setError(null)
    const timeSpent = Math.round((Date.now() - questionStartTime) / 1000)
    try {
      const res = await quizApi.submitAnswer(session.id, {
        question_id: currentQuestion.question_id,
        user_answer: payload,
        time_spent_seconds: timeSpent,
        request_ai_grade: opts?.requestAiGrade,
      })
      const result = res as unknown as QuizAnswerResult
      setLastResult(result)
      setSession((prev) =>
        prev
          ? {
              ...prev,
              answered_count: result.answered_count,
              status: result.session_status,
            }
          : prev
      )
      addReviewItem(result, currentQuestion.stem, payload)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "提交失败"
      if (isSessionExpiredError(msg)) handleSessionExpired()
      else setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmitAnswer = async () => {
    await submitAnswerCore()
  }

  const handleAiReview = async () => {
    await submitAnswerCore({ requestAiGrade: true })
  }

  const handleUnknown = async () => {
    if (!session || !currentQuestion || submitting) return
    setSubmitting(true)
    setError(null)
    const timeSpent = Math.round((Date.now() - questionStartTime) / 1000)
    try {
      const res = await quizApi.submitAnswer(session.id, {
        question_id: currentQuestion.question_id,
        status: "unknown",
        time_spent_seconds: timeSpent,
      })
      const result = res as unknown as QuizAnswerResult
      setSession((prev) =>
        prev
          ? {
              ...prev,
              answered_count: result.answered_count,
              status: result.session_status,
            }
          : prev
      )
      addReviewItem(result, currentQuestion.stem, "我不会")
      // "我不会" 不展示答案，由 Tutor 窗口进行辅导，
      // 设置 lastResult 让反馈面板显示「已标记「我不会」」
      setLastResult(result)
      // 发送辅导消息到当前题的 TutorPanel
      tutorPanelRef.current?.sendMessage("我不会做这道题，请给我一些提示")
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "标记失败"
      if (isSessionExpiredError(msg)) handleSessionExpired()
      else setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleMarkAsUnknown = async () => {
    if (!session || !currentQuestion || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await quizApi.submitAnswer(session.id, {
        question_id: currentQuestion.question_id,
        status: "unknown",
      })
      const result = res as unknown as QuizAnswerResult
      setLastResult(result)
      addReviewItem(result, currentQuestion.stem, "我不会")
      tutorPanelRef.current?.sendMessage("这道题我做错了，请帮我讲解一下")
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "标记失败"
      if (isSessionExpiredError(msg)) handleSessionExpired()
      else setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleNextAfterReview = () => {
    if (lastResult) advanceOrFinish(lastResult)
  }

  const quizStats = {
    total: questionListData?.total ?? selectedDocument?.questionCount ?? 0,
    answered: questionListData?.answered_count ?? 0,
    correct: questionListData?.correct_count ?? 0,
    wrong: questionListData?.wrong_count ?? 0,
    unknown: questionListData?.unknown_count ?? 0,
  }

  return (
    <AppShell maxWidth={1180}>
      <PageHeader
        title="题库页"
        subtitle="按知识库文档浏览题目，选中后开始练习，答题时可随时使用 AI 辅导"
      >
        <Button variant="secondary" size="md" onClick={() => navigate("/question-gen")}>
          前往出题
        </Button>
      </PageHeader>

      {error && (
        <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-body text-danger">
          {error}
        </div>
      )}

      {genAlertDocName && (
        <div className="mb-4 rounded-lg border border-primary/30 bg-primary-soft px-4 py-3 flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-primary shrink-0" />
          <span className="text-body text-ink-primary">
            正在为「{genAlertDocName}」出题，请稍候…
          </span>
        </div>
      )}

      {phase === "setup" && (
        <>
          {loadingCollections ? (
            <div className="flex items-center justify-center py-16 text-ink-tertiary gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>加载分区...</span>
            </div>
          ) : collections.length === 0 ? (
            <EmptyState
              icon={Brain}
              title="暂无知识库分区"
              description="请先在知识库上传学习区文档并等待分段完成"
              primaryAction={{ label: "去知识库", onClick: () => navigate("/knowledge") }}
            />
          ) : (
            <>
              {setupAlert && (
                <Alert className="mb-4 border-warning/30 bg-warning-soft text-ink-primary">
                  <AlertCircle className="text-warning" />
                  <AlertTitle>暂时无法开始练习</AlertTitle>
                  <AlertDescription className="text-ink-secondary">
                    {setupAlert}{" "}
                    <Link to="/knowledge" className="text-primary hover:underline">
                      前往知识库查看文档状态
                    </Link>
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] gap-6 min-h-[480px]">
                <KbDocBrowser
                  collections={collections}
                  selectedCollectionId={selectedCollectionId}
                  onCollectionChange={handleCollectionChange}
                  documents={documents}
                  loading={loadingDocuments}
                  selectedDocumentId={selectedDocumentId}
                  onDocumentSelect={handleDocumentSelect}
                  emptyTitle="该分区还没有文档"
                  emptyDescription="上传资料并完成分段后，可在此刷题练习"
                  emptyAction={{ label: "去知识库", onClick: () => navigate("/knowledge") }}
                />

                <div className="flex flex-col min-h-0">
                  {!selectedDocument ? (
                    <div className="bg-surface border border-line-soft rounded-lg shadow-xs flex-1 flex items-center justify-center p-8">
                      <EmptyState
                        icon={FileText}
                        title="选择一份文档"
                        description="从左侧列表点击文档，查看题目进度与统计"
                        size="md"
                      />
                    </div>
                  ) : (
                    <div className="bg-surface border border-line-soft rounded-lg shadow-xs flex flex-col flex-1 min-h-0 overflow-hidden">
                      <div className="px-5 py-4 border-b border-line-soft shrink-0">
                        <div className="text-body font-medium text-ink-primary truncate mb-2">
                          {selectedDocument.name}
                        </div>
                        <DocumentPipelineBadge
                          segment_status={selectedDocument.segment_status}
                          question_gen_status={selectedDocument.question_gen_status}
                          questionCount={selectedDocument.questionCount}
                          zone={selectedDocument.zone || selectedCollection?.zone}
                        />
                      </div>

                      {isLifeZone || selectedDocument.zone === "life" ? (
                        <div className="p-5 text-body text-ink-secondary">
                          生活区文档不支持刷题，请切换到学习区文档。
                        </div>
                      ) : (
                        <>
                          <div className="grid grid-cols-2 gap-3 p-4 border-b border-line-soft shrink-0">
                            <StatCard icon={FileText} label="题目" value={quizStats.total} tone="primary" />
                            <StatCard icon={CheckCircle2} label="已做" value={quizStats.answered} tone="info" />
                            <StatCard icon={CheckCircle2} label="正确" value={quizStats.correct} tone="success" />
                            <StatCard icon={HelpCircle} label="错误/不会" value={quizStats.wrong + quizStats.unknown} tone="warning" />
                          </div>

                          <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-line-soft shrink-0">
                            <Button
                              variant="primary"
                              size="md"
                              onClick={handleStart}
                              disabled={!canStartQuiz}
                              title={
                                !docReadyForQuiz
                                  ? "请等待出题完成或先生成题目"
                                  : isLifeZone
                                    ? "生活区不支持练习"
                                    : undefined
                              }
                              style={{ color: '#FFFFFF' }}
                            >
                              {starting ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Play className="w-4 h-4" strokeWidth={2} />
                              )}
                              开始练习
                            </Button>
                            <Button
                              variant="secondary"
                              size="md"
                              onClick={() => setDeleteDialogOpen(true)}
                              disabled={!canDeleteQuestions}
                              title={!canDeleteQuestions ? "暂无题目可删除" : undefined}
                              className="text-danger hover:text-danger"
                            >
                              <Trash2 className="w-4 h-4" strokeWidth={2} />
                              删除题库
                            </Button>
                          </div>

                          {!docReadyForQuiz && (
                            <p className="px-4 py-2 text-caption text-ink-tertiary shrink-0">
                              {selectedDocument.segment_status === "processing"
                                ? "文档分段中，完成后可前往出题页生成题目。"
                                : "该文档尚无题目，请前往出题页按页生成。"}
                            </p>
                          )}

                          <div className="flex-1 min-h-0 flex flex-col p-4">
                            <div className="flex items-center justify-between mb-3 shrink-0">
                              <div className="text-small font-medium text-ink-primary">题目列表</div>
                              {loadingQuestions && (
                                <Loader2 className="w-4 h-4 animate-spin text-ink-tertiary" />
                              )}
                            </div>
                            {!loadingQuestions && questionListData && questionListData.questions.length > 0 ? (
                              <ul className="space-y-2 overflow-y-auto scroll-thin flex-1">
                                {questionListData.questions.map((q, i) => (
                                  <li key={q.id} className="flex items-start gap-2 text-small">
                                    <span className="text-ink-tertiary shrink-0 w-6">{i + 1}.</span>
                                    <MarkdownWithMath className="flex-1 line-clamp-2 text-small">
                                      {q.stem}
                                    </MarkdownWithMath>
                                    <QuestionStatusBadge
                                      status={q.user_answer_status}
                                      attemptCount={q.attempt_count}
                                    />
                                  </li>
                                ))}
                              </ul>
                            ) : !loadingQuestions && docReadyForQuiz ? (
                              <p className="text-caption text-ink-tertiary">暂无题目详情</p>
                            ) : !loadingQuestions ? (
                              <p className="text-caption text-ink-tertiary">出题完成后可查看题目列表</p>
                            ) : null}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {phase === "quiz" && session && currentQuestion && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 lg:h-[calc(100vh-12rem)] min-h-0">
          <div className="bg-surface border border-line-soft rounded-lg shadow-xs p-6 overflow-y-auto scroll-thin min-h-0">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Badge variant="neutral">
                  第 {currentIndex + 1} / {session.total_questions} 题
                </Badge>
                <Badge variant="primary" size="sm">
                  {QUESTION_TYPE_LABEL[currentQuestion.question_type] ||
                    currentQuestion.question_type}
                </Badge>
                {currentQuestion.source_type === "textbook" ? (
                  <Badge variant="success" size="sm">
                    📖 课本原题
                  </Badge>
                ) : (
                  <Badge variant="warning" size="sm">
                    🤖 AI 出题
                  </Badge>
                )}
              </div>
              <span className="text-small text-ink-tertiary truncate max-w-[50%]">
                {selectedDocument?.name || session.title}
              </span>
            </div>

            <QuizQuestionInput
              question={currentQuestion}
              selectedOption={selectedOption}
              textAnswer={textAnswer}
              blankAnswers={blankAnswers}
              customAnswers={customAnswers}
              lastResult={lastResult}
              submitting={submitting}
              onSelectOption={setSelectedOption}
              onTextAnswerChange={setTextAnswer}
              onBlankAnswersChange={setBlankAnswers}
              onCustomAnswersChange={setCustomAnswers}
            />

            {!lastResult ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleSubmitAnswer}
                  disabled={
                    submitting ||
                    !canSubmitAnswer(
                      currentQuestion.question_type,
                      selectedOption,
                      textAnswer,
                      blankAnswers
                    )
                  }
                >
                  {getSubmitButtonLabel(submitting, currentQuestion.question_type)}
                </Button>
                <Button variant="secondary" size="md" onClick={handleUnknown} disabled={submitting}>
                  <HelpCircle className="w-4 h-4" strokeWidth={2} />
                  我不会
                </Button>
              </div>
            ) : (
              <QuizAnswerFeedback
                question={currentQuestion}
                lastResult={lastResult}
                submitting={submitting}
                onNext={handleNextAfterReview}
                onAiReview={handleAiReview}
                onMarkUnknown={handleMarkAsUnknown}
              />
            )}
          </div>

          <div className="flex flex-col min-h-0 h-[420px] lg:h-full overflow-hidden">
            <TutorPanel
              ref={tutorPanelRef}
              key={currentQuestion.question_id}
              questionId={currentQuestion.question_id}
              quizSessionId={session.id}
              className="flex-1 min-h-0"
            />
          </div>
        </div>
      )}
      {phase === "quiz" && reviewItems.length > 0 && (
        <div className="mt-4 bg-surface border border-line-soft rounded-lg p-4 max-h-[200px] overflow-y-auto scroll-thin">
          <div className="text-card-title font-semibold text-ink-primary mb-3">本题回顾</div>
          <QuizReviewPanel items={reviewItems} />
        </div>
      )}

      {phase === "done" && session && (
        <div className="space-y-6">
          <div className="bg-surface border border-line-soft rounded-lg p-6 text-center">
            <CheckCircle2 className="w-12 h-12 text-success mx-auto mb-3" strokeWidth={1.5} />
            <div className="text-card-title font-semibold text-ink-primary mb-2">本轮练习完成</div>
            {resultsSummary && (
              <div className="flex items-center justify-center gap-6 text-body text-ink-secondary">
                <span>正确 {resultsSummary.correct}</span>
                <span>错误 {resultsSummary.wrong}</span>
                <span>我不会 {resultsSummary.unknown}</span>
              </div>
            )}
            <div className="mt-4 flex justify-center gap-3">
              <Button variant="secondary" size="md" onClick={() => setPhase("setup")}>
                <ChevronLeft className="w-4 h-4" />
                返回文档列表
              </Button>
            </div>
          </div>

          {reviewItems.length > 0 && (
            <div className="bg-surface border border-line-soft rounded-lg p-5">
              <div className="text-card-title font-semibold text-ink-primary mb-4">错题汇总</div>
              <QuizReviewPanel items={reviewItems} />
            </div>
          )}
        </div>
      )}

      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          if (!open && !deletingQuestions) setDeleteDialogOpen(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除题库？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除「{selectedDocument?.name}」下的全部题目引用（共{" "}
              {questionListData?.total ?? selectedDocument?.questionCount ?? 0}{" "}
              题）。答题历史记录会保留，全局题目不会被删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingQuestions}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void handleDeleteQuestions()
              }}
              disabled={deletingQuestions}
              className="bg-danger text-white hover:bg-danger/90"
            >
              {deletingQuestions ? "删除中..." : "删除题库"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  )
}
