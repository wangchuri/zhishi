import { useCallback, useEffect, useRef, useState } from "react"

import { Link, useNavigate, useSearchParams } from "react-router-dom"

import {

  AlertCircle,

  Brain,

  CheckCircle2,

  ChevronLeft,

  ChevronRight,

  HelpCircle,

  Loader2,

  Play,

} from "lucide-react"

import { AppShell } from "@/components/layout/AppShell"

import { RightPanel } from "@/components/layout/RightPanel"

import { PageHeader } from "@/components/blocks/PageHeader"

import { CitationCard } from "@/components/blocks/CitationCard"

import {
  DocumentPipelineBadge,
  formatDocumentOptionLabel,
} from "@/components/blocks/DocumentPipelineBadge"

import { Button } from "@/components/ui/button"

import { EmptyState } from "@/components/ui/empty-state"

import { SegmentedTabs } from "@/components/ui/segmented-tabs"

import { Badge } from "@/components/ui/badge"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

import {

  Select,

  SelectContent,

  SelectItem,

  SelectTrigger,

  SelectValue,

} from "@/components/ui/select"

import { kbApi, questionsApi, quizApi } from "@/lib/api"

import type {

  KbCollection,

  QuizAnswerResult,

  QuizReviewItem,

  QuizSession,

} from "@/types"

import { QuizReviewPanel } from "./QuizReviewPanel"

import { TutorPanel } from "@/features/tutor/TutorPanel"

import { cn } from "@/lib/utils"



type Phase = "setup" | "quiz" | "done"



interface QuizDocument {

  id: string

  name: string

  segment_status: string

  question_gen_status: string

  zone?: string

  questionCount?: number

}



function mapApiDocument(d: Record<string, unknown>, zone?: string): QuizDocument {

  return {

    id: String(d.id),

    name: String(d.name || d.file_name || d.id),

    segment_status: String(d.segment_status || "not_started"),

    question_gen_status: String(d.question_gen_status || "not_started"),

    zone: String(d.zone || zone || ""),

    questionCount: undefined,

  }

}



export function QuizPage() {

  const navigate = useNavigate()

  const [searchParams] = useSearchParams()

  const [collections, setCollections] = useState<KbCollection[]>([])

  const [selectedCollectionId, setSelectedCollectionId] = useState<string>("")

  const [documents, setDocuments] = useState<QuizDocument[]>([])

  const [selectedDocumentId, setSelectedDocumentId] = useState<string>("")

  const [loadingSetup, setLoadingSetup] = useState(true)

  const [starting, setStarting] = useState(false)

  const [generating, setGenerating] = useState(false)

  const [error, setError] = useState<string | null>(null)

  const [setupAlert, setSetupAlert] = useState<string | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)



  const [phase, setPhase] = useState<Phase>("setup")

  const [session, setSession] = useState<QuizSession | null>(null)

  const [currentIndex, setCurrentIndex] = useState(0)

  const [selectedOption, setSelectedOption] = useState<string | null>(null)

  const [submitting, setSubmitting] = useState(false)

  const [lastResult, setLastResult] = useState<QuizAnswerResult | null>(null)

  const [reviewItems, setReviewItems] = useState<QuizReviewItem[]>([])

  const [resultsSummary, setResultsSummary] = useState<{

    correct: number

    wrong: number

    unknown: number

  } | null>(null)

  const [tutorQuestionId, setTutorQuestionId] = useState<string | null>(null)

  const [questionStartTime, setQuestionStartTime] = useState(Date.now())



  const selectedCollection = collections.find((c) => c.id === selectedCollectionId)

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



  const refreshDocuments = useCallback(

    async (collectionId: string, zone?: string): Promise<QuizDocument[]> => {

      const res = await kbApi.listDocuments(1, 50, collectionId)

      const docs = (res.documents || []).map((d: Record<string, unknown>) =>

        mapApiDocument(d, zone)

      )

      setDocuments(docs)

      return docs

    },

    []

  )



  useEffect(() => {

    kbApi

      .listCollections()

      .then((res) => {

        const cols = (res.collections || []) as KbCollection[]

        setCollections(cols)

        const defaultCol = cols.find((c) => c.is_default && c.zone === "study") || cols.find((c) => c.zone === "study") || cols[0]

        if (defaultCol) setSelectedCollectionId(defaultCol.id)

      })

      .catch(() => setCollections([]))

      .finally(() => setLoadingSetup(false))

  }, [])



  useEffect(() => {

    if (!selectedCollectionId) {

      setDocuments([])

      return

    }

    const col = collections.find((c) => c.id === selectedCollectionId)

    refreshDocuments(selectedCollectionId, col?.zone)

      .then((docs) => {

        const urlDocId = searchParams.get("document_id")

        if (urlDocId && docs.some((d) => d.id === urlDocId)) {

          setSelectedDocumentId(urlDocId)

        } else {

          setSelectedDocumentId("")

        }

      })

      .catch(() => setDocuments([]))

  }, [selectedCollectionId, collections, refreshDocuments, searchParams])



  useEffect(() => {

    if (!selectedDocumentId) return

    fetchQuestionCount(selectedDocumentId).then((count) => {

      setDocuments((prev) =>

        prev.map((d) => (d.id === selectedDocumentId ? { ...d, questionCount: count } : d))

      )

    })

  }, [selectedDocumentId, fetchQuestionCount])



  useEffect(() => {

    return () => {

      if (pollRef.current) clearInterval(pollRef.current)

    }

  }, [])



  const stopPolling = () => {

    if (pollRef.current) {

      clearInterval(pollRef.current)

      pollRef.current = null

    }

  }



  const startPollingDocument = (documentId: string) => {

    stopPolling()

    pollRef.current = setInterval(async () => {

      try {

        const col = collections.find((c) => c.id === selectedCollectionId)

        const docs = await refreshDocuments(selectedCollectionId, col?.zone)

        const doc = docs.find((d) => d.id === documentId)

        if (!doc) return



        const count = await fetchQuestionCount(documentId)

        setDocuments((prev) =>

          prev.map((d) => (d.id === documentId ? { ...d, questionCount: count } : d))

        )



        if (doc.question_gen_status === "completed" || doc.question_gen_status === "failed") {

          setGenerating(false)

          stopPolling()

        }

      } catch {

        /* ignore poll errors */

      }

    }, 2500)

  }



  const currentQuestion = session?.questions[currentIndex]



  const addReviewItem = useCallback((result: QuizAnswerResult, stem: string, userAnswer?: string) => {

    if (result.status !== "wrong" && result.status !== "unknown") return

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

  }, [selectedOption])



  const handleStart = async () => {

    if (!selectedCollectionId && !selectedDocumentId) {

      setError("请选择知识库分区或文档")

      return

    }

    if (isLifeZone && !selectedDocumentId) {

      setSetupAlert("生活区文档仅支持检索与对话，刷题请切换到学习区或选择学习区文档。")

      return

    }

    setStarting(true)

    setError(null)

    setSetupAlert(null)

    try {

      const payload: Record<string, string> = {}

      if (selectedDocumentId) payload.document_id = selectedDocumentId

      else payload.collection_id = selectedCollectionId



      const res = await quizApi.createSession(payload)

      const s = res as unknown as QuizSession

      setSession(s)

      setCurrentIndex(0)

      setSelectedOption(null)

      setLastResult(null)

      setReviewItems([])

      setResultsSummary(null)

      setTutorQuestionId(null)

      setQuestionStartTime(Date.now())

      setPhase("quiz")

    } catch (err: unknown) {

      const msg = err instanceof Error ? err.message : "创建刷题会话失败"

      if (msg.includes("尚未出题") || msg.includes("没有可用题目") || msg.includes("409")) {

        setSetupAlert(msg)

      } else {

        setError(msg)

      }

    } finally {

      setStarting(false)

    }

  }



  const handleGenerateQuestions = async () => {

    if (!selectedDocumentId) {

      setError("请先选择一份文档再出题")

      return

    }

    if (isLifeZone || selectedDocument?.zone === "life") {

      setSetupAlert("生活区文档不支持刷题，请在学习区上传资料。")

      return

    }

    setGenerating(true)

    setError(null)

    setSetupAlert(null)

    try {

      await questionsApi.generate({ document_id: selectedDocumentId })

      startPollingDocument(selectedDocumentId)

    } catch (err: unknown) {

      setGenerating(false)

      setError(err instanceof Error ? err.message : "出题失败")

    }

  }



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

    setLastResult(null)

    setQuestionStartTime(Date.now())

  }



  const handleSubmitAnswer = async () => {

    if (!session || !currentQuestion || !selectedOption || submitting) return

    setSubmitting(true)

    setError(null)

    const timeSpent = Math.round((Date.now() - questionStartTime) / 1000)

    try {

      const res = await quizApi.submitAnswer(session.id, {

        question_id: currentQuestion.question_id,

        user_answer: selectedOption,

        time_spent_seconds: timeSpent,

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

      addReviewItem(result, currentQuestion.stem, selectedOption)

    } catch (err: unknown) {

      setError(err instanceof Error ? err.message : "提交失败")

    } finally {

      setSubmitting(false)

    }

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

      addReviewItem(result, currentQuestion.stem, "我不会")

      setTutorQuestionId(currentQuestion.question_id)

    } catch (err: unknown) {

      setError(err instanceof Error ? err.message : "提交失败")

    } finally {

      setSubmitting(false)

    }

  }



  const handleNextAfterReview = () => {

    if (lastResult) advanceOrFinish(lastResult)

  }



  const zoneLabel = (zone: string) => (zone === "life" ? "生活区" : "学习区")



  const docReadyForQuiz =

    selectedDocument &&

    selectedDocument.question_gen_status === "completed" &&

    (selectedDocument.questionCount ?? 0) > 0



  const canStartQuiz =

    !starting &&

    !generating &&

    !isLifeZone &&

    (!selectedDocumentId || docReadyForQuiz)



  return (

    <AppShell maxWidth={1180}>

      <PageHeader

        title="刷题练习"

        subtitle="基于知识库题目检验掌握程度，错题可查看原文并求助 Agent"

      />



      {error && (

        <div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-body text-danger">

          {error}

        </div>

      )}



      {phase === "setup" && (

        <div className="space-y-6">

          {loadingSetup ? (

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

                <Alert className="border-warning/30 bg-warning-soft text-ink-primary">

                  <AlertCircle className="text-warning" />

                  <AlertTitle>暂时无法开始刷题</AlertTitle>

                  <AlertDescription className="text-ink-secondary">

                    {setupAlert}

                    {selectedDocumentId && (

                      <>

                        {" "}

                        <Link to="/knowledge" className="text-primary hover:underline">

                          前往知识库查看文档状态

                        </Link>

                      </>

                    )}

                  </AlertDescription>

                </Alert>

              )}



              <div>

                <div className="text-small text-ink-tertiary mb-2">选择知识库分区</div>

                <SegmentedTabs

                  tabs={collections.map((c) => ({

                    label: `${c.name} · ${zoneLabel(c.zone)}`,

                    value: c.id,

                  }))}

                  value={selectedCollectionId}

                  onChange={setSelectedCollectionId}

                />

                {isLifeZone && (

                  <p className="text-caption text-ink-tertiary mt-2">

                    生活区文档仅支持检索与对话，刷题请切换到学习区。

                  </p>

                )}

              </div>



              <div>

                <div className="flex items-center gap-2 mb-2">

                  <div className="text-small text-ink-tertiary">

                    可选：限定某份文档（留空则从整个分区抽题）

                  </div>

                  {selectedDocument && (

                    <DocumentPipelineBadge

                      segment_status={selectedDocument.segment_status}

                      question_gen_status={selectedDocument.question_gen_status}

                      questionCount={selectedDocument.questionCount}

                      zone={selectedDocument.zone || selectedCollection?.zone}

                    />

                  )}

                </div>

                <Select

                  value={selectedDocumentId || "__all__"}

                  onValueChange={(v) => setSelectedDocumentId(v === "__all__" ? "" : v)}

                >

                  <SelectTrigger className="w-full max-w-md h-10 border-line bg-surface text-body text-ink-primary">

                    <SelectValue placeholder="整个分区" />

                  </SelectTrigger>

                  <SelectContent>

                    <SelectItem value="__all__">整个分区</SelectItem>

                    {documents.map((d) => {

                      const isLifeDoc = d.zone === "life" || isLifeZone

                      return (

                        <SelectItem

                          key={d.id}

                          value={d.id}

                          disabled={isLifeDoc}

                          title={isLifeDoc ? "仅学习区可刷题" : undefined}

                        >

                          {formatDocumentOptionLabel(d.name, {

                            segment_status: d.segment_status,

                            question_gen_status: d.question_gen_status,

                            questionCount: d.questionCount,

                            zone: d.zone || selectedCollection?.zone,

                          })}

                        </SelectItem>

                      )

                    })}

                  </SelectContent>

                </Select>

                {selectedDocumentId && !docReadyForQuiz && !isLifeZone && (

                  <p className="text-caption text-ink-tertiary mt-2">

                    {generating || selectedDocument?.question_gen_status === "processing"

                      ? "出题进行中，请稍候..."

                      : selectedDocument?.segment_status === "processing"

                        ? "文档分段中，完成后可出题。"

                        : "该文档尚无题目，请先点击下方「为该文档出题」。"}

                  </p>

                )}

              </div>



              <div className="flex flex-wrap items-center gap-3">

                <Button

                  variant="primary"

                  size="md"

                  onClick={handleStart}

                  disabled={!canStartQuiz}

                  title={

                    selectedDocumentId && !docReadyForQuiz

                      ? "请等待出题完成或先生成题目"

                      : isLifeZone

                        ? "生活区不支持刷题"

                        : undefined

                  }

                >

                  {starting ? (

                    <Loader2 className="w-4 h-4 animate-spin" />

                  ) : (

                    <Play className="w-4 h-4" strokeWidth={2} />

                  )}

                  开始刷题

                </Button>

                {selectedDocumentId && !isLifeZone && (

                  <Button

                    variant="secondary"

                    size="md"

                    onClick={handleGenerateQuestions}

                    disabled={

                      generating ||

                      selectedDocument?.question_gen_status === "processing" ||

                      selectedDocument?.segment_status !== "completed"

                    }

                  >

                    {generating || selectedDocument?.question_gen_status === "processing" ? (

                      <>

                        <Loader2 className="w-4 h-4 animate-spin" />

                        出题中...

                      </>

                    ) : (

                      "为该文档出题"

                    )}

                  </Button>

                )}

              </div>

            </>

          )}

        </div>

      )}



      {phase === "quiz" && session && currentQuestion && (

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">

          <div className="bg-surface border border-line-soft rounded-lg shadow-xs p-6">

            <div className="flex items-center justify-between mb-6">

              <Badge variant="neutral">

                第 {currentIndex + 1} / {session.total_questions} 题

              </Badge>

              <span className="text-small text-ink-tertiary">{session.title}</span>

            </div>



            <div className="text-card-title font-semibold text-ink-primary mb-6 leading-relaxed">

              {currentQuestion.stem}

            </div>



            <div className="space-y-2.5 mb-6">

              {(currentQuestion.options || []).map((opt) => (

                <button

                  key={opt.key}

                  type="button"

                  disabled={!!lastResult || submitting}

                  onClick={() => setSelectedOption(opt.key)}

                  className={cn(

                    "w-full text-left rounded-lg border px-4 py-3 text-body transition-colors",

                    selectedOption === opt.key

                      ? "border-primary bg-primary-soft text-ink-primary"

                      : "border-line-soft hover:border-primary/30 hover:bg-surface-soft",

                    lastResult?.correct_answer === opt.key && "border-success bg-success-soft",

                    lastResult &&

                      lastResult.status !== "correct" &&

                      selectedOption === opt.key &&

                      "border-danger bg-danger-soft"

                  )}

                >

                  <span className="font-medium mr-2">{opt.key}.</span>

                  {opt.text}

                </button>

              ))}

            </div>



            {!lastResult ? (

              <div className="flex flex-wrap items-center gap-3">

                <Button

                  variant="primary"

                  size="md"

                  onClick={handleSubmitAnswer}

                  disabled={!selectedOption || submitting}

                >

                  {submitting ? "提交中..." : "提交答案"}

                </Button>

                <Button variant="secondary" size="md" onClick={handleUnknown} disabled={submitting}>

                  <HelpCircle className="w-4 h-4" strokeWidth={2} />

                  我不会

                </Button>

              </div>

            ) : (

              <div className="space-y-3">

                <div

                  className={cn(

                    "flex items-center gap-2 text-body font-medium",

                    lastResult.status === "correct" ? "text-success" : "text-warning"

                  )}

                >

                  {lastResult.status === "correct" ? (

                    <>

                      <CheckCircle2 className="w-5 h-5" />

                      回答正确

                    </>

                  ) : lastResult.status === "unknown" ? (

                    <>已标记「我不会」</>

                  ) : (

                    <>回答错误，正确答案：{lastResult.correct_answer}</>

                  )}

                </div>

                {lastResult.explanation && (

                  <div className="text-body text-ink-primary bg-surface-soft rounded-md p-3 border border-line-soft">

                    {lastResult.explanation}

                  </div>

                )}

                {lastResult.status !== "correct" && lastResult.citation && (

                  <CitationCard citation={lastResult.citation} />

                )}

                <div className="flex flex-wrap gap-3 pt-1">

                  <Button variant="primary" size="md" onClick={handleNextAfterReview}>

                    下一题

                    <ChevronRight className="w-4 h-4" strokeWidth={2} />

                  </Button>

                  {lastResult.status !== "correct" && (

                    <Button

                      variant="secondary"

                      size="md"

                      onClick={() => setTutorQuestionId(currentQuestion.question_id)}

                    >

                      和 Agent 聊聊

                    </Button>

                  )}

                </div>

              </div>

            )}

          </div>



          <div className="space-y-4">

            {tutorQuestionId ? (

              <TutorPanel

                questionId={tutorQuestionId}

                quizSessionId={session.id}

                onClose={() => setTutorQuestionId(null)}

                className="min-h-[420px]"

              />

            ) : (

              <div className="bg-surface border border-line-soft rounded-lg p-4">

                <div className="text-card-title font-semibold text-ink-primary mb-3">错题回顾</div>

                <QuizReviewPanel

                  items={reviewItems}

                  onAskTutor={(item) => setTutorQuestionId(item.question_id)}

                />

              </div>

            )}

          </div>

        </div>

      )}



      {phase === "done" && session && (

        <div className="space-y-6">

          <div className="bg-surface border border-line-soft rounded-lg p-6 text-center">

            <CheckCircle2 className="w-12 h-12 text-success mx-auto mb-3" strokeWidth={1.5} />

            <div className="text-card-title font-semibold text-ink-primary mb-2">刷题完成</div>

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

                再来一组

              </Button>

            </div>

          </div>

          {reviewItems.length > 0 && (

            <div className="bg-surface border border-line-soft rounded-lg p-5">

              <div className="text-card-title font-semibold text-ink-primary mb-4">错题汇总</div>

              <QuizReviewPanel

                items={reviewItems}

                onAskTutor={(item) => {

                  setPhase("quiz")

                  setTutorQuestionId(item.question_id)

                }}

              />

            </div>

          )}

        </div>

      )}



      <RightPanel title="刷题提示">

        <div className="text-small text-ink-tertiary space-y-2 leading-relaxed">

          <p>• 学习区文档分段完成后可自动或手动出题</p>

          <p>• 答错或点「我不会」可查看原文引用</p>

          <p>• 辅导 Agent 会结合题目与分段引导思考</p>

        </div>

      </RightPanel>

    </AppShell>

  )

}


