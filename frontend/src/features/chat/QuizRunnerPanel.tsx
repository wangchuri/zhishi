import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, ChevronRight, HelpCircle, Loader2, SkipForward } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { quizApi } from "@/lib/api"
import { QuizQuestionInput } from "@/features/quiz/QuizQuestionInput"
import { QuizAnswerFeedback } from "@/features/quiz/QuizAnswerFeedback"
import { QuizSessionPicker } from "@/features/quiz/QuizSessionPicker"
import { sessionTitle } from "@/features/quiz/quizSessionFormat"
import {
  QUESTION_TYPE_LABEL,
  buildUserAnswerPayload,
  canSubmitAnswer,
  isAiGradedQuestion,
} from "@/features/quiz/quizQuestionUtils"
import type { QuizAnswerResult, QuizSession, QuizSessionSummary } from "@/types"

interface QuizRunnerPanelProps {
  /** 当前选中的刷题会话（null = 还在选会话） */
  quizSessionId?: string | null
  /** 选中某场会话 */
  onPickSession: (session: QuizSessionSummary) => void
  /** 回到会话选择列表 */
  onBackToPicker: () => void
  /** 把「我不会 / 这题怎么想」发到 Tina 聊天里 */
  onAskTina: (text: string) => void
  /** 把当前题目告诉后端（用户发消息时会带上题目信息） */
  onContextChange: (quizSessionId: string | null, questionId: string | null) => void
  /** 去资料页开新练习 */
  onOpenLibrary?: () => void
}

/**
 * Tina 右侧的刷题面板：先选会话（与刷题页同一套列表），再逐题作答。
 * 这里没有辅导窗口——左边就是 Tina；「我不会」会把题目上下文发给它。
 */
export function QuizRunnerPanel({
  quizSessionId,
  onPickSession,
  onBackToPicker,
  onAskTina,
  onContextChange,
  onOpenLibrary,
}: QuizRunnerPanelProps) {
  const [sessions, setSessions] = useState<QuizSessionSummary[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [session, setSession] = useState<QuizSession | null>(null)
  const [loading, setLoading] = useState(false)
  const [index, setIndex] = useState(0)
  const [selectedOption, setSelectedOption] = useState<string | null>(null)
  const [textAnswer, setTextAnswer] = useState("")
  const [blankAnswers, setBlankAnswers] = useState<string[]>([])
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({})
  const [lastResult, setLastResult] = useState<QuizAnswerResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentQuestion = session?.questions[index]

  // 选会话阶段：拉刷题会话列表
  useEffect(() => {
    if (quizSessionId) return
    let cancelled = false
    setLoadingSessions(true)
    quizApi
      .listSessionHistory(20)
      .then((res) => {
        if (cancelled) return
        setSessions(res.sessions || [])
        setSessionsError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setSessions([])
        setSessionsError(err instanceof Error ? err.message : "刷题记录加载失败")
      })
      .finally(() => {
        if (!cancelled) setLoadingSessions(false)
      })
    return () => {
      cancelled = true
    }
  }, [quizSessionId, reloadKey])

  // 进入某场会话：拉详情，定位到第一道没答的题
  useEffect(() => {
    if (!quizSessionId) {
      setSession(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    quizApi
      .getSession(quizSessionId)
      .then((res) => {
        if (cancelled) return
        const s = res as QuizSession
        setSession(s)
        const total = s.total_questions || 0
        // 定位到上次停下的那一题
        const nextIndex = Math.min(s.progress_index ?? 0, Math.max(0, total - 1))
        setIndex(nextIndex)
        setSelectedOption(null)
        setTextAnswer("")
        setBlankAnswers([])
        setCustomAnswers({})
        setLastResult(null)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "会话加载失败")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [quizSessionId])

  // 当前题目同步给后端：用户在左边问 Tina 时，题目信息会自动带上
  useEffect(() => {
    if (!quizSessionId) {
      onContextChange(null, null)
      return
    }
    onContextChange(quizSessionId, currentQuestion?.question_id ?? null)
  }, [quizSessionId, currentQuestion?.question_id, onContextChange])

  const resetInputs = useCallback(() => {
    setSelectedOption(null)
    setTextAnswer("")
    setBlankAnswers([])
    setCustomAnswers({})
    setLastResult(null)
    setError(null)
  }, [])

  const submit = async (opts?: { unknown?: boolean }) => {
    if (!session || !currentQuestion || submitting) return
    const qtype = currentQuestion.question_type || "single_choice"
    const payload = buildUserAnswerPayload(
      qtype,
      selectedOption,
      textAnswer,
      blankAnswers,
      customAnswers,
    )
    if (!opts?.unknown) {
      const hasAnswer = canSubmitAnswer(
        qtype,
        selectedOption,
        textAnswer,
        blankAnswers,
        customAnswers,
      )
      if (!hasAnswer) return
    }

    setSubmitting(true)
    setError(null)
    const isDeferred = (session.mode || "instant") === "deferred" && !opts?.unknown
    try {
      const res = await quizApi.submitAnswer(session.id, {
        question_id: currentQuestion.question_id,
        user_answer: opts?.unknown ? undefined : payload,
        status: opts?.unknown ? "unknown" : undefined,
        defer_grade: isDeferred || undefined,
      })
      const result = res as QuizAnswerResult
      setSession((prev) =>
        prev
          ? { ...prev, answered_count: result.answered_count, status: result.session_status }
          : prev,
      )
      if (opts?.unknown) onAskTina("我不会做这道题，请给我一些提示")
      if (isDeferred) {
        // 统一结算：不显示判题反馈，直接下一题
        goNext()
        return
      }
      setLastResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败")
    } finally {
      setSubmitting(false)
    }
  }

  const goNext = () => {
    if (!session) return
    const nextIndex = index + 1
    if (nextIndex >= (session.total_questions || 0)) {
      // 统一结算模式：最后一题答完，先把 pending 判出来
      if ((session.mode || "instant") === "deferred") {
        void quizApi.gradeAll(session.id).catch(() => {
          /* 结算失败不影响退出 */
        })
      }
      onBackToPicker()
      return
    }
    setIndex(nextIndex)
    // 上报游标：刷题页/另一端据此对齐位置
    void quizApi.setProgress(session.id, nextIndex).catch(() => {
      /* 同步失败不影响答题 */
    })
    resetInputs()
  }

  // ---- 选会话 ----
  if (!quizSessionId) {
    return (
      <div className="h-full overflow-y-auto scroll-thin p-3">
        <QuizSessionPicker
          sessions={sessions}
          loading={loadingSessions}
          error={sessionsError}
          onRetry={() => setReloadKey((k) => k + 1)}
          onPick={onPickSession}
          onOpenLibrary={onOpenLibrary}
        />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-small text-ink-soft">
        <Loader2 className="w-4 h-4 animate-spin" />
        正在加载题目…
      </div>
    )
  }

  if (error && !session) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-4 text-center">
        <p className="text-small text-danger">{error}</p>
        <Button variant="secondary" size="sm" onClick={onBackToPicker}>
          返回选择会话
        </Button>
      </div>
    )
  }

  if (!session || !currentQuestion) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-4 text-center">
        <p className="text-small text-ink-soft">这场会话没有可作答的题目</p>
        <Button variant="secondary" size="sm" onClick={onBackToPicker}>
          换一场
        </Button>
      </div>
    )
  }

  const qtype = currentQuestion.question_type || "single_choice"
  const answered = session.answered_count || 0
  const total = session.total_questions || 0

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* 顶部：会话信息 + 进度 */}
      <div className="shrink-0 px-3 py-2 border-b border-line-soft">
        <button
          type="button"
          onClick={onBackToPicker}
          className="inline-flex items-center gap-1 text-caption text-ink-soft hover:text-sea"
        >
          <ArrowLeft className="w-3.5 h-3.5" strokeWidth={2} />
          换一场
        </button>
        <p className="mt-1 text-small font-medium text-ink-primary truncate" title={sessionTitle(session)}>
          {sessionTitle(session)}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <Badge variant="neutral" size="sm">
            第 {index + 1} / {total} 题
          </Badge>
          <Badge variant="primary" size="sm">
            {QUESTION_TYPE_LABEL[qtype] || qtype}
          </Badge>
          <span className="text-caption text-ink-soft">已答 {answered} 题</span>
        </div>
      </div>

      {/* 题目 + 作答区 */}
      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin px-3 py-3 space-y-3">
        {error && (
          <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-caption text-danger">
            {error}
          </div>
        )}
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
          documentId={session.document_id}
        />
        {lastResult && (
          <QuizAnswerFeedback
            question={currentQuestion}
            lastResult={lastResult}
            documentId={session.document_id}
          />
        )}
      </div>

      {/* 底部操作 */}
      <div className="shrink-0 border-t border-line-soft px-3 py-2 flex flex-wrap gap-2">
        {!lastResult ? (
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void submit()}
              disabled={
                submitting ||
                !canSubmitAnswer(qtype, selectedOption, textAnswer, blankAnswers, customAnswers)
              }
            >
              {submitting
                ? isAiGradedQuestion(qtype)
                  ? "判题中…"
                  : "提交中…"
                : "提交答案"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void submit({ unknown: true })}
              disabled={submitting}
            >
              <HelpCircle className="w-3.5 h-3.5" strokeWidth={2} />
              我不会
            </Button>
            <Button variant="ghost" size="sm" onClick={goNext} disabled={submitting}>
              <SkipForward className="w-3.5 h-3.5" strokeWidth={2} />
              跳过
            </Button>
          </>
        ) : (
          <Button variant="primary" size="sm" onClick={goNext}>
            下一题
            <ChevronRight className="w-3.5 h-3.5" strokeWidth={2} />
          </Button>
        )}
      </div>
    </div>
  )
}
