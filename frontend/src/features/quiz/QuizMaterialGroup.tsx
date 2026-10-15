import { useRef, useState } from "react"
import { HelpCircle, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { quizApi } from "@/lib/api"
import { notifyCompletedTasks } from "@/lib/taskNotify"
import { QuizQuestionInput } from "./QuizQuestionInput"
import { QuizAnswerFeedback } from "./QuizAnswerFeedback"
import {
  QUESTION_TYPE_LABEL,
  buildUserAnswerPayload,
  canSubmitAnswer,
  getBlankCount,
} from "./quizQuestionUtils"
import type {
  QuizAnswerResult,
  QuizQuestionMaterial,
  QuizReviewItem,
  QuizSessionQuestion,
} from "@/types"

interface AnswerState {
  selectedOption: string | null
  textAnswer: string
  blankAnswers: string[]
  customAnswers: Record<string, string>
}

interface SubmitBody {
  question_id: string
  user_answer?: string
  status?: "unknown"
  time_spent_seconds?: number
}

export interface MaterialGroupSummary {
  answeredCount: number
  completed: boolean
  maxStreak: number
  reviewItems: QuizReviewItem[]
}

interface Props {
  sessionId: string
  material: QuizQuestionMaterial
  questions: QuizSessionQuestion[]
  documentId?: string | null
  /** 提交并「继续」后回调，交给父级推进/收尾 */
  onGroupDone: (summary: MaterialGroupSummary) => void
  /** 会话失效等错误 */
  onError: (message: string) => void
}

function emptyAnswer(q: QuizSessionQuestion): AnswerState {
  return {
    selectedOption: null,
    textAnswer: "",
    blankAnswers:
      q.question_type === "fill_blank"
        ? Array.from({ length: getBlankCount(q) }, () => "")
        : [],
    customAnswers: {},
  }
}

/** 材料题：一段材料 + 多个子题同屏作答，一次提交一起评分。 */
export function QuizMaterialGroup({
  sessionId,
  material,
  questions,
  documentId,
  onGroupDone,
  onError,
}: Props) {
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({})
  const [results, setResults] = useState<Record<string, QuizAnswerResult>>({})
  const [summary, setSummary] = useState<MaterialGroupSummary | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const startRef = useRef(Date.now())

  const getAnswer = (q: QuizSessionQuestion): AnswerState =>
    answers[q.question_id] || emptyAnswer(q)

  const patch = (qid: string, q: QuizSessionQuestion, part: Partial<AnswerState>) =>
    setAnswers((prev) => ({ ...prev, [qid]: { ...(prev[qid] || emptyAnswer(q)), ...part } }))

  const allAnswerable = questions.every((q) => {
    const a = getAnswer(q)
    return canSubmitAnswer(q.question_type, a.selectedOption, a.textAnswer, a.blankAnswers, a.customAnswers)
  })

  const submitted = Object.keys(results).length > 0

  const runSubmit = async (mode: "normal" | "unknown") => {
    if (submitting || submitted) return
    setSubmitting(true)
    const perQuestion = Math.max(
      1,
      Math.round((Date.now() - startRef.current) / 1000 / Math.max(1, questions.length)),
    )
    const nextResults: Record<string, QuizAnswerResult> = {}
    const reviewItems: QuizReviewItem[] = []
    let answeredCount = 0
    let completed = false
    let maxStreak = 0
    try {
      for (const q of questions) {
        const a = getAnswer(q)
        const qtype = q.question_type || "single_choice"
        let body: SubmitBody
        if (mode === "unknown") {
          body = { question_id: q.question_id, status: "unknown", time_spent_seconds: perQuestion }
        } else {
          if (!canSubmitAnswer(qtype, a.selectedOption, a.textAnswer, a.blankAnswers, a.customAnswers)) {
            continue
          }
          body = {
            question_id: q.question_id,
            user_answer: buildUserAnswerPayload(
              qtype,
              a.selectedOption,
              a.textAnswer,
              a.blankAnswers,
              a.customAnswers,
            ),
            time_spent_seconds: perQuestion,
          }
        }
        const res = (await quizApi.submitAnswer(sessionId, body)) as unknown as QuizAnswerResult
        nextResults[q.question_id] = res
        notifyCompletedTasks(res)
        answeredCount = res.answered_count
        completed = res.session_status === "completed"
        maxStreak = Math.max(maxStreak, res.current_streak ?? 0)
        if (res.status === "wrong" || res.status === "unknown" || res.status === "partial") {
          reviewItems.push({
            question_id: res.question_id,
            stem: q.stem,
            user_answer: res.status === "unknown" ? "我不会" : body.user_answer ?? "",
            status: res.status,
            correct_answer: res.correct_answer || "—",
            explanation: res.explanation,
            citation: res.citation,
          })
        }
      }
      setResults(nextResults)
      setSummary({ answeredCount, completed, maxStreak, reviewItems })
    } catch (err) {
      onError(err instanceof Error ? err.message : "提交失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin p-6">
        <div className="mb-5 rounded-lg border border-line-soft bg-paper-2/50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="neutral" size="sm">
              {material.kind === "cloze" ? "完形填空" : "阅读材料"}
            </Badge>
            {material.title ? (
              <span className="text-small font-medium text-ink-primary truncate">
                {material.title}
              </span>
            ) : null}
            <span className="text-caption text-ink-tertiary ml-auto shrink-0">
              共 {questions.length} 小题
            </span>
          </div>
          <div className="text-body text-ink leading-relaxed whitespace-pre-wrap break-words">
            {material.content}
          </div>
        </div>

        <div className="space-y-5">
          {questions.map((q, i) => {
            const a = getAnswer(q)
            const res = results[q.question_id]
            return (
              <div key={q.question_id} className="rounded-lg border border-line-soft bg-surface p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Badge variant="neutral" size="sm">
                    {q.sub_index ?? i + 1}
                  </Badge>
                  <Badge variant="primary" size="sm">
                    {QUESTION_TYPE_LABEL[q.question_type] || q.question_type}
                  </Badge>
                </div>
                <QuizQuestionInput
                  question={q}
                  selectedOption={a.selectedOption}
                  textAnswer={a.textAnswer}
                  blankAnswers={a.blankAnswers}
                  customAnswers={a.customAnswers}
                  lastResult={res ?? null}
                  submitting={submitting}
                  documentId={documentId}
                  onSelectOption={(v) => patch(q.question_id, q, { selectedOption: v })}
                  onTextAnswerChange={(v) => patch(q.question_id, q, { textAnswer: v })}
                  onBlankAnswersChange={(v) => patch(q.question_id, q, { blankAnswers: v })}
                  onCustomAnswersChange={(v) => patch(q.question_id, q, { customAnswers: v })}
                />
                {res ? (
                  <div className="mt-4">
                    <QuizAnswerFeedback question={q} lastResult={res} />
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      <div className="shrink-0 border-t border-line-soft px-6 py-4">
        {!submitted ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              size="md"
              onClick={() => void runSubmit("normal")}
              disabled={submitting || !allAnswerable}
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : null}
              提交本材料全部小题
            </Button>
            <Button variant="secondary" size="md" onClick={() => void runSubmit("unknown")} disabled={submitting}>
              <HelpCircle className="w-4 h-4" strokeWidth={2} />
              我不会
            </Button>
            {!allAnswerable ? (
              <span className="text-caption text-ink-tertiary">请先作答本材料全部小题，再一起提交</span>
            ) : null}
          </div>
        ) : (
          <Button variant="primary" size="md" onClick={() => summary && onGroupDone(summary)}>
            继续
          </Button>
        )}
      </div>
    </div>
  )
}
