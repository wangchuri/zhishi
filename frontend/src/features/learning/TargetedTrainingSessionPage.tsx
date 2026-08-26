import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import {
  Brain,
  CheckCircle2,
  HelpCircle,
  LogOut,
  Sparkles,
  Target,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { analyticsApi, quizApi, trainingApi } from "@/lib/api"
import { formatAccuracy, splitTagLabels } from "@/lib/utils"
import { TutorPanel } from "@/features/tutor/TutorPanel"
import { TrainingTutorPanel } from "@/features/learning/TrainingTutorPanel"
import { QuizQuestionInput } from "@/features/quiz/QuizQuestionInput"
import { QuizAnswerFeedback, getSubmitButtonLabel } from "@/features/quiz/QuizAnswerFeedback"
import {
  QUESTION_TYPE_LABEL,
  buildUserAnswerPayload,
  canSubmitAnswer,
  getBlankCount,
} from "@/features/quiz/quizQuestionUtils"
import type {
  QuizAnswerResult,
  QuizSession,
  QuizSessionQuestion,
  TagStats,
  TargetedTrainingResult,
  WeakTag,
} from "@/types"

type Phase = "loading" | "quiz" | "done"

export function TargetedTrainingSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>("loading")
  const [error, setError] = useState<string | null>(null)
  const [trainingMeta, setTrainingMeta] = useState<TargetedTrainingResult | null>(null)
  const [tagStats, setTagStats] = useState<TagStats[]>([])
  const [session, setSession] = useState<QuizSession | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [selectedOption, setSelectedOption] = useState<string | null>(null)
  const [textAnswer, setTextAnswer] = useState("")
  const [blankAnswers, setBlankAnswers] = useState<string[]>([])
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [lastResult, setLastResult] = useState<QuizAnswerResult | null>(null)
  const [questionStartTime, setQuestionStartTime] = useState(Date.now())
  const initRef = useRef(false)

  const currentQuestion: QuizSessionQuestion | undefined = session?.questions[currentIndex]
  const reportId = trainingMeta?.report_id

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

  const exitToReport = useCallback(() => {
    if (reportId) {
      navigate(`/training/targeted/report/${reportId}`)
    } else {
      navigate("/analytics")
    }
  }, [navigate, reportId])

  const loadSession = useCallback(async () => {
    if (!sessionId) return
    setPhase("loading")
    setError(null)
    try {
      const [training, tags] = await Promise.all([
        trainingApi.resumeSession(sessionId),
        analyticsApi.getTagStats(),
      ])
      setTrainingMeta(training)
      setSession(training.session)
      setTagStats(tags.by_tag)

      const resumeIndex = Math.min(
        training.session.answered_count,
        Math.max(0, training.session.total_questions - 1)
      )
      setCurrentIndex(resumeIndex)
      setSelectedOption(null)
      setTextAnswer("")
      setLastResult(null)
      setQuestionStartTime(Date.now())

      if (training.session.status === "completed") {
        setPhase("done")
      } else if (training.session.answered_count >= training.session.total_questions) {
        setPhase("done")
      } else {
        setPhase("quiz")
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "加载训练会话失败")
      setPhase("loading")
    }
  }, [sessionId])

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true
    loadSession()
  }, [loadSession])

  const advanceOrFinish = async (result: QuizAnswerResult) => {
    setLastResult(null)
    setSelectedOption(null)
    setTextAnswer("")
    setBlankAnswers([])
    if (currentIndex + 1 >= (session?.total_questions ?? 0)) {
      setPhase("done")
      return
    }
    setCurrentIndex((i) => i + 1)
    setQuestionStartTime(Date.now())
    if (result.session_status === "completed") {
      setPhase("done")
    }
  }

  const submitAnswerCore = async (opts?: { requestAiGrade?: boolean }) => {
    if (!session || !currentQuestion) return
    const qtype = currentQuestion.question_type || "single_choice"
    const payload = buildUserAnswerPayload(qtype, selectedOption, textAnswer, blankAnswers, customAnswers)
    if (!opts?.requestAiGrade && !canSubmitAnswer(qtype, selectedOption, textAnswer, blankAnswers, customAnswers)) {
      return
    }

    setSubmitting(true)
    try {
      const timeSpent = Math.round((Date.now() - questionStartTime) / 1000)
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "提交失败")
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = async () => {
    await submitAnswerCore()
  }

  const handleAiReview = async () => {
    await submitAnswerCore({ requestAiGrade: true })
  }

  const handleUnknown = async () => {
    if (!session || !currentQuestion) return
    setSubmitting(true)
    try {
      const timeSpent = Math.round((Date.now() - questionStartTime) / 1000)
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "提交失败")
    } finally {
      setSubmitting(false)
    }
  }

  const weakTags: WeakTag[] = trainingMeta?.weak_tags ?? []

  if (phase === "loading" && !error) {
    return (
      <div className="h-full min-h-[calc(100vh-3rem)] flex flex-col items-center justify-center bg-bg gap-4">
        <div className="w-12 h-12 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        <p className="text-body text-ink-primary font-medium">加载训练会话…</p>
      </div>
    )
  }

  if (error && !session) {
    return (
      <div className="h-full min-h-[calc(100vh-3rem)] flex flex-col items-center justify-center bg-bg gap-4 px-6">
        <p className="text-body text-danger text-center max-w-md">{error}</p>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={exitToReport}>
            返回
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              initRef.current = false
              loadSession()
            }}
          >
            重试
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full min-h-[calc(100vh-3rem)] flex flex-col bg-bg">
      <header className="shrink-0 border-b border-line-soft bg-surface px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-primary" strokeWidth={2} />
          <h1 className="text-body font-semibold text-ink-primary">针对训练</h1>
          {session && phase === "quiz" && (
            <Badge variant="primary" size="sm">
              {session.answered_count}/{session.total_questions}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {phase === "quiz" && (
            <Button variant="ghost" size="sm" onClick={exitToReport}>
              <LogOut className="w-4 h-4" />
              退出
            </Button>
          )}
          {phase === "done" && reportId && (
            <Button variant="ghost" size="sm" onClick={exitToReport}>
              返回报告
            </Button>
          )}
        </div>
      </header>

      {error && (
        <div className="mx-4 mt-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-2 text-small text-danger">
          {error}
        </div>
      )}

      {phase === "done" ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <Card className="p-8 text-center max-w-md">
            <CheckCircle2 className="w-12 h-12 text-success mx-auto mb-3" />
            <h2 className="text-card-title font-semibold mb-2">本轮针对训练完成</h2>
            <p className="text-body text-ink-secondary mb-4">
              共完成 {session?.total_questions ?? 0} 题，继续巩固薄弱知识点吧。
            </p>
            <div className="flex flex-wrap gap-3 justify-center">
              {reportId && (
                <Button variant="secondary" onClick={exitToReport}>
                  返回报告
                </Button>
              )}
              <Button
                variant="primary"
                onClick={() => {
                  if (reportId) {
                    navigate(`/training/targeted/report/${reportId}`)
                  }
                }}
              >
                <Sparkles className="w-4 h-4" />
                再来一轮
              </Button>
            </div>
          </Card>
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_320px] gap-0 min-h-0 overflow-hidden">
          <aside className="border-r border-line-soft bg-surface overflow-y-auto scroll-thin p-4 hidden lg:block">
            <h2 className="text-small font-semibold text-ink-primary mb-3">薄弱知识点</h2>
            {weakTags.length === 0 ? (
              <p className="text-small text-ink-tertiary">暂无 tag 统计</p>
            ) : (
              <ul className="space-y-2 mb-6">
                {weakTags.map((t) => (
                  <li
                    key={t.tag}
                    className="rounded-lg border border-line-soft px-3 py-2 text-small"
                  >
                    <div className="font-medium text-ink-primary truncate">
                      {splitTagLabels(t.tag).join(" · ")}
                    </div>
                    <div className="text-ink-tertiary mt-0.5">
                      错 {t.wrong_count} · 对 {t.correct_count}
                      {t.accuracy_rate != null && ` · ${formatAccuracy(t.accuracy_rate)}`}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <h2 className="text-small font-semibold text-ink-primary mb-3">全部 Tag 统计</h2>
            <ul className="space-y-1.5">
              {tagStats.slice(0, 12).map((t) => (
                <li key={t.tag} className="flex justify-between text-caption text-ink-secondary">
                  <span className="truncate mr-2">{splitTagLabels(t.tag).join(" · ")}</span>
                  <span className="shrink-0 text-danger">{t.wrong_count} 错</span>
                </li>
              ))}
            </ul>
          </aside>

          <main className="overflow-y-auto scroll-thin p-4 lg:p-6 min-h-0">
            {session && currentQuestion ? (
              <div className="max-w-2xl mx-auto">
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <Badge variant="neutral">
                    第 {currentIndex + 1} / {session.total_questions} 题
                  </Badge>
                  <Badge variant="primary" size="sm">
                    {QUESTION_TYPE_LABEL[currentQuestion.question_type] ||
                      currentQuestion.question_type}
                  </Badge>
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
                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="primary"
                      onClick={handleSubmit}
                      disabled={
                        submitting ||
                        !canSubmitAnswer(
                          currentQuestion.question_type,
                          selectedOption,
                          textAnswer,
                          blankAnswers,
                          customAnswers
                        )
                      }
                    >
                      {getSubmitButtonLabel(submitting, currentQuestion.question_type)}
                    </Button>
                    <Button variant="secondary" onClick={handleUnknown} disabled={submitting}>
                      <HelpCircle className="w-4 h-4" />
                      我不会
                    </Button>
                  </div>
                ) : (
                  <QuizAnswerFeedback
                    question={currentQuestion}
                    lastResult={lastResult}
                    submitting={submitting}
                    onNext={() => advanceOrFinish(lastResult)}
                    onAiReview={handleAiReview}
                  />
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-ink-tertiary gap-2">
                <Brain className="w-5 h-5" />
                暂无题目
              </div>
            )}
          </main>

          <aside className="border-l border-line-soft bg-surface min-h-[320px] lg:min-h-0 flex flex-col overflow-hidden">
            {trainingMeta?.agent_session_id ? (
              <TrainingTutorPanel
                agentSessionId={trainingMeta.agent_session_id}
                rationale={trainingMeta.rationale}
                className="flex-1 min-h-0"
              />
            ) : currentQuestion ? (
              <TutorPanel
                key={currentQuestion.question_id}
                questionId={currentQuestion.question_id}
                quizSessionId={session?.id}
                className="flex-1 min-h-0"
              />
            ) : (
              <div className="p-4 text-small text-ink-tertiary">AI 教练加载中…</div>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}
