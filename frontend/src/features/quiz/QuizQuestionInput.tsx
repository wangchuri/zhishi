import { MarkdownWithMath } from "@/components/blocks/MarkdownWithMath"
import type { QuizAnswerResult, QuizSessionQuestion } from "@/types"
import { cn } from "@/lib/utils"
import {
  getBlankCount,
  isChoiceQuestion,
  isFillBlankQuestion,
  isTextQuestion,
  splitStemWithBlanks,
} from "./quizQuestionUtils"

type QuizQuestionInputProps = {
  question: QuizSessionQuestion
  selectedOption: string | null
  textAnswer: string
  blankAnswers: string[]
  lastResult: QuizAnswerResult | null
  submitting: boolean
  onSelectOption: (key: string) => void
  onTextAnswerChange: (value: string) => void
  onBlankAnswersChange: (values: string[]) => void
}

export function QuizQuestionInput({
  question,
  selectedOption,
  textAnswer,
  blankAnswers,
  lastResult,
  submitting,
  onSelectOption,
  onTextAnswerChange,
  onBlankAnswersChange,
}: QuizQuestionInputProps) {
  const qtype = question.question_type || "single_choice"
  const disabled = !!lastResult || submitting

  if (isChoiceQuestion(qtype)) {
    return (
      <>
        <MarkdownWithMath className="text-card-title font-semibold mb-6 leading-relaxed">
          {question.stem}
        </MarkdownWithMath>
        <div className="space-y-2.5 mb-6">
        {(question.options || []).map((opt) => (
          <button
            key={opt.key}
            type="button"
            disabled={disabled}
            onClick={() => onSelectOption(opt.key)}
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
            <MarkdownWithMath
              proseClass="prose prose-sm max-w-none inline prose-p:inline prose-p:my-0 prose-p:text-inherit"
              className="inline"
            >
              {opt.text}
            </MarkdownWithMath>
          </button>
        ))}
        </div>
      </>
    )
  }

  if (isFillBlankQuestion(qtype)) {
    const blankCount = getBlankCount(question)
    const parts = splitStemWithBlanks(question.stem)
    const hasInlineBlanks = parts.some((p) => p.type === "blank")
    let blankIndex = 0

    const updateBlank = (index: number, value: string) => {
      const next = [...blankAnswers]
      while (next.length < blankCount) next.push("")
      next[index] = value
      onBlankAnswersChange(next)
    }

    if (hasInlineBlanks) {
      return (
        <div className="mb-6 text-body leading-relaxed">
          {parts.map((part, i) => {
            if (part.type === "text") {
              return (
                <MarkdownWithMath
                  key={`t-${i}`}
                  proseClass="prose prose-sm max-w-none inline prose-p:inline prose-p:my-0"
                  className="inline"
                >
                  {part.value}
                </MarkdownWithMath>
              )
            }
            const idx = blankIndex++
            return (
              <input
                key={`b-${i}`}
                type="text"
                value={blankAnswers[idx] ?? ""}
                onChange={(e) => updateBlank(idx, e.target.value)}
                disabled={disabled}
                className="inline-block align-baseline mx-1 min-w-[6rem] max-w-[12rem] rounded border border-line-soft bg-surface px-2 py-1 text-body focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder={`空${idx + 1}`}
              />
            )
          })}
        </div>
      )
    }

    return (
      <div className="mb-6 space-y-3">
        <MarkdownWithMath className="text-body leading-relaxed">{question.stem}</MarkdownWithMath>
        {Array.from({ length: blankCount }).map((_, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <span className="text-small text-ink-tertiary shrink-0 w-12">空 {idx + 1}</span>
            <input
              type="text"
              value={blankAnswers[idx] ?? ""}
              onChange={(e) => updateBlank(idx, e.target.value)}
              disabled={disabled}
              className="flex-1 rounded-lg border border-line-soft bg-surface px-4 py-2.5 text-body focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="请输入答案"
            />
          </div>
        ))}
      </div>
    )
  }

  if (isTextQuestion(qtype)) {
    return (
      <>
        <MarkdownWithMath className="text-card-title font-semibold mb-4 leading-relaxed">
          {question.stem}
        </MarkdownWithMath>
        <textarea
          className="w-full min-h-[140px] rounded-lg border border-line-soft bg-surface px-4 py-3 text-body mb-6 focus:outline-none focus:ring-2 focus:ring-primary/30"
          placeholder="请输入你的答案…"
          value={textAnswer}
          onChange={(e) => onTextAnswerChange(e.target.value)}
          disabled={disabled}
        />
      </>
    )
  }

  return null
}
