import type { ReactNode } from "react"
import { CheckCircle2, ChevronRight, HelpCircle, Sparkles, XCircle } from "lucide-react"
import { MarkdownWithMath } from "@/components/blocks/MarkdownWithMath"
import { CitationCard } from "@/components/blocks/CitationCard"
import { getApiBase } from "@/lib/api"
import { Button } from "@/components/ui/button"
import type { QuizAnswerResult, QuizSessionQuestion } from "@/types"
import { cn } from "@/lib/utils"
import {
  formatCorrectAnswerDisplay,
  isAiGradedQuestion,
  isFillBlankQuestion,
} from "./quizQuestionUtils"

type QuizAnswerFeedbackProps = {
  question: QuizSessionQuestion
  lastResult: QuizAnswerResult
  submitting?: boolean
  onNext?: () => void
  onAiReview?: () => void
  onMarkUnknown?: () => void
  /** 来源文档 id，用于解析题目中的图片相对路径（images/xxx） */
  documentId?: string | null
}

function statusLabel(status: string): { text: string; className: string; icon: ReactNode } {
  if (status === "correct") {
    return {
      text: "回答正确",
      className: "text-success",
      icon: <CheckCircle2 className="w-5 h-5" />,
    }
  }
  if (status === "partial") {
    return {
      text: "部分正确",
      className: "text-warning",
      icon: <HelpCircle className="w-5 h-5" />,
    }
  }
  if (status === "unknown") {
    return {
      text: "已标记「我不会」",
      className: "text-warning",
      icon: <HelpCircle className="w-5 h-5" />,
    }
  }
  return {
    text: "回答错误",
    className: "text-warning",
    icon: <XCircle className="w-5 h-5" />,
  }
}

export function QuizAnswerFeedback({
  question,
  lastResult,
  documentId,
}: QuizAnswerFeedbackProps) {
  const qtype = question.question_type || "single_choice"
  const info = statusLabel(lastResult.status)
  const correctDisplay = formatCorrectAnswerDisplay(lastResult.correct_answer, qtype)
  const isUnknown = lastResult.status === "unknown"

  const imageBase = documentId
    ? `${getApiBase().replace(/\/$/, "")}/api/v1/kb/documents/${encodeURIComponent(documentId)}/images`
    : undefined

  return (
    <div className="space-y-3">
      <div className={cn("flex items-center gap-2 text-body font-medium", info.className)}>
        {info.icon}
        {info.text}
        {lastResult.status !== "correct" && lastResult.status !== "unknown" && correctDisplay && (
          <span className="font-normal text-ink-secondary">
            ，参考：{correctDisplay}
          </span>
        )}
      </div>

      {lastResult.ai_reason && (
        <div className="text-small text-ink-secondary bg-primary-soft/40 rounded-md px-3 py-2 border border-primary/20">
          <span className="font-medium text-ink-primary">AI 评语：</span>
          {lastResult.ai_reason}
        </div>
      )}

      {lastResult.string_match_status &&
        lastResult.grade_method === "ai" &&
        lastResult.string_match_status !== lastResult.status && (
          <p className="text-caption text-ink-tertiary">
            字符串匹配结果为「
            {lastResult.string_match_status === "correct" ? "正确" : "错误"}
            」，AI 已重新裁定。
          </p>
        )}

      {!isUnknown && lastResult.explanation && (
        <div className="text-body text-ink-primary bg-surface-soft rounded-md p-3 border border-line-soft">
          <MarkdownWithMath imageBaseUrl={imageBase}>{lastResult.explanation}</MarkdownWithMath>
        </div>
      )}

      {!isUnknown && lastResult.status !== "correct" && lastResult.citation && (
        <CitationCard citation={lastResult.citation} />
      )}
    </div>
  )
}

/**
 * 答题反馈的操作条（下一题 / AI 判题 / 标记不会）。
 * 独立出来以便放在常驻操作栏（不随内容滚动出视口）。
 */
export function QuizAnswerFeedbackActions({
  question,
  lastResult,
  submitting,
  onNext,
  onAiReview,
  onMarkUnknown,
}: QuizAnswerFeedbackProps) {
  const qtype = question.question_type || "single_choice"
  const isUnknown = lastResult.status === "unknown"
  const showAiReview =
    isFillBlankQuestion(qtype) &&
    lastResult.status === "wrong" &&
    lastResult.grade_method !== "ai" &&
    onAiReview

  return (
    <div className="flex flex-wrap gap-3">
      {showAiReview && (
        <Button variant="secondary" size="md" onClick={onAiReview} disabled={submitting}>
          {submitting ? (
            <>
              <Sparkles className="w-4 h-4 animate-pulse" />
              AI 判题中…
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              让 AI 判断
            </>
          )}
        </Button>
      )}
      {!isUnknown && lastResult.status !== "correct" && onMarkUnknown && (
        <Button variant="secondary" size="md" onClick={onMarkUnknown} disabled={submitting}>
          <HelpCircle className="w-4 h-4" strokeWidth={2} />
          标记为不会
        </Button>
      )}
      <Button variant="primary" size="md" onClick={onNext}>
        下一题
        <ChevronRight className="w-4 h-4" strokeWidth={2} />
      </Button>
    </div>
  )
}

export function getSubmitButtonLabel(
  submitting: boolean,
  qtype?: string,
  requestAiGrade?: boolean
): string {
  if (!submitting) return "提交答案"
  if (requestAiGrade) return "AI 判题中…"
  if (isAiGradedQuestion(qtype)) return "AI 判题中…"
  return "提交中…"
}
