import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { QuizQuestionInput } from "@/features/quiz/QuizQuestionInput"
import { QuizAnswerFeedback } from "@/features/quiz/QuizAnswerFeedback"
import { quizApi } from "@/lib/api"
import {
  QUESTION_TYPE_LABEL,
  buildUserAnswerPayload,
  canSubmitAnswer,
  getBlankCount,
  isAiGradedQuestion,
  isChoiceQuestion,
  isCustomQuestion,
  isFillBlankQuestion,
} from "@/features/quiz/quizQuestionUtils"
import type { QuizAnswerResult, QuizSessionQuestion } from "@/types"

export type ChatQuestionPayload = {
  question_id: string
  stem: string
  question_type: string
  options?: Array<{ key: string; text: string }>
  source_type?: string
  html_content?: string | null
  answer_params?: string | null
  document_id?: string | null
  document_name?: string | null
  tags?: string[]
}

export type ChatQuestionWidget = {
  question: ChatQuestionPayload
  result?: QuizAnswerResult | null
  user_answer?: string | null
}

export function followUpFromWidget(_widget: ChatQuestionWidget, userAnswer: string, status: string): string {
  const answer = (userAnswer || "").trim()
  if (status === "unknown") return "这道题我不会。"
  if (status === "correct") {
    return answer ? `我选了 ${answer}，是对的。` : "这道题我做对了。"
  }
  if (status === "partial") {
    return answer ? `我答了 ${answer}，部分正确。` : "这道题部分正确。"
  }
  return answer ? `我选了 ${answer}，是错的。` : "这道题我做错了。"
}

function toSessionQuestion(q: ChatQuestionPayload): QuizSessionQuestion {
  return {
    question_id: q.question_id,
    order_index: 0,
    stem: q.stem,
    question_type: q.question_type,
    options: q.options,
    source_type: q.source_type,
    html_content: q.html_content,
    answer_params: q.answer_params,
  }
}

export function ChatQuestionCard({
  widget,
  chatMessageId,
  disabled,
  onResolved,
}: {
  widget: ChatQuestionWidget
  chatMessageId?: string | null
  disabled?: boolean
  onResolved: (next: ChatQuestionWidget, followUp: string) => void
}) {
  const q = toSessionQuestion(widget.question)
  const [selectedOption, setSelectedOption] = useState<string | null>(
    widget.user_answer && isChoiceQuestion(q.question_type) ? widget.user_answer : null
  )
  const [textAnswer, setTextAnswer] = useState(
    !isChoiceQuestion(q.question_type) && widget.user_answer ? widget.user_answer : ""
  )
  const [blankAnswers, setBlankAnswers] = useState<string[]>(() =>
    isFillBlankQuestion(widget.question.question_type)
      ? Array.from({ length: getBlankCount(toSessionQuestion(widget.question)) }, () => "")
      : []
  )
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastResult = widget.result || null
  const locked = !!lastResult || !!disabled

  const submit = async (opts?: { option?: string; unknown?: boolean }) => {
    if (submitting || lastResult) return
    const option = opts?.option ?? selectedOption
    const qtype = q.question_type
    if (!opts?.unknown && !canSubmitAnswer(qtype, option, textAnswer, blankAnswers, customAnswers)) {
      return
    }
    const payload = opts?.unknown
      ? undefined
      : buildUserAnswerPayload(qtype, option, textAnswer, blankAnswers, customAnswers)
    setSubmitting(true)
    setError(null)
    try {
      const res = (await quizApi.grade({
        question_id: q.question_id,
        user_answer: payload,
        status: opts?.unknown ? "unknown" : undefined,
        document_id: widget.question.document_id || undefined,
        chat_message_id: chatMessageId || undefined,
        request_ai_grade:
          !opts?.unknown && (isAiGradedQuestion(q.question_type) || isCustomQuestion(q.question_type)),
      })) as QuizAnswerResult
      const userDisplay = opts?.unknown ? "我不会" : payload || ""
      const next: ChatQuestionWidget = {
        ...widget,
        result: res,
        user_answer: userDisplay,
      }
      onResolved(next, followUpFromWidget(next, userDisplay, res.status))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "提交失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-line-soft bg-paper-2/60 p-4">
      {widget.question.document_name && (
        <div className="text-caption text-ink-tertiary mb-2 truncate">
          {QUESTION_TYPE_LABEL[q.question_type] || q.question_type}
          {" · "}
          {widget.question.document_name}
        </div>
      )}
      <QuizQuestionInput
        question={q}
        selectedOption={selectedOption}
        textAnswer={textAnswer}
        blankAnswers={blankAnswers}
        customAnswers={customAnswers}
        lastResult={lastResult}
        submitting={submitting || locked}
        documentId={widget.question.document_id}
        onSelectOption={(key) => {
          setSelectedOption(key)
          if (isChoiceQuestion(q.question_type) && !lastResult) {
            void submit({ option: key })
          }
        }}
        onTextAnswerChange={setTextAnswer}
        onBlankAnswersChange={setBlankAnswers}
        onCustomAnswersChange={setCustomAnswers}
      />
      {lastResult && (
        <div className="mt-4">
          <QuizAnswerFeedback question={q} lastResult={lastResult} documentId={widget.question.document_id} />
        </div>
      )}
      {!lastResult && (
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {!isChoiceQuestion(q.question_type) && (
            <Button
              variant="primary"
              size="sm"
              disabled={submitting || !canSubmitAnswer(q.question_type, selectedOption, textAnswer, blankAnswers, customAnswers)}
              onClick={() => void submit()}
              style={{ color: "#FFFFFF" }}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "提交"}
            </Button>
          )}
          <Button variant="secondary" size="sm" disabled={submitting} onClick={() => void submit({ unknown: true })}>
            不会
          </Button>
          {isChoiceQuestion(q.question_type) && (
            <span className="text-caption text-ink-tertiary">点选项即提交</span>
          )}
        </div>
      )}
      {error && <p className="text-caption text-danger mt-2">{error}</p>}
    </div>
  )
}
