import type { QuizSessionQuestion } from "@/types"

export const QUESTION_TYPE_LABEL: Record<string, string> = {
  single_choice: "选择题",
  fill_blank: "填空题",
  short_answer: "简答题",
  application: "应用题",
  custom: "自定义题",
}

const BLANK_PATTERN = /_{3,}|\{\{blank\}\}/gi

export function isChoiceQuestion(qtype?: string | null): boolean {
  return !qtype || qtype === "single_choice"
}

export function isFillBlankQuestion(qtype?: string | null): boolean {
  return qtype === "fill_blank"
}

export function isTextQuestion(qtype?: string | null): boolean {
  return qtype === "short_answer" || qtype === "application"
}

export function isCustomQuestion(qtype?: string | null): boolean {
  return qtype === "custom"
}

export function isAiGradedQuestion(qtype?: string | null): boolean {
  return isTextQuestion(qtype) || isFillBlankQuestion(qtype)
}

export function parseAnswerParams(raw: string | null | undefined): Array<{ key: string; label: string; type: string }> {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
  } catch { /* ignore */ }
  return []
}

export function countBlankSlots(stem: string): number {
  const matches = stem.match(BLANK_PATTERN)
  return matches?.length ?? 0
}

export function getBlankCount(question: QuizSessionQuestion): number {
  const fromStem = countBlankSlots(question.stem)
  if (fromStem > 0) return fromStem
  return 1
}

export function parseBlankAnswers(raw: string): string[] {
  if (!raw.trim()) return []
  try {
    const data = JSON.parse(raw)
    if (Array.isArray(data)) {
      return data.map((v) => String(v))
    }
  } catch {
    /* fall through */
  }
  return [raw]
}

export function serializeBlankAnswers(values: string[]): string {
  return JSON.stringify(values)
}

export function splitStemWithBlanks(stem: string): Array<{ type: "text" | "blank"; value: string }> {
  const parts: Array<{ type: "text" | "blank"; value: string }> = []
  let lastIndex = 0
  const regex = new RegExp(BLANK_PATTERN.source, "gi")
  let match: RegExpExecArray | null
  while ((match = regex.exec(stem)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: stem.slice(lastIndex, match.index) })
    }
    parts.push({ type: "blank", value: match[0] })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < stem.length) {
    parts.push({ type: "text", value: stem.slice(lastIndex) })
  }
  if (parts.length === 0) {
    parts.push({ type: "text", value: stem })
  }
  return parts
}

export function formatCorrectAnswerDisplay(correctAnswer?: string | null, qtype?: string): string {
  if (!correctAnswer) return ""
  if (qtype === "fill_blank") {
    const parts = parseBlankAnswers(correctAnswer)
    if (parts.length > 1) return parts.join("；")
    return parts[0] ?? correctAnswer
  }
  return correctAnswer
}

export function canSubmitAnswer(
  qtype: string | undefined,
  selectedOption: string | null,
  textAnswer: string,
  blankAnswers: string[],
  customAnswers?: Record<string, string>
): boolean {
  if (isChoiceQuestion(qtype)) return !!selectedOption
  if (isFillBlankQuestion(qtype)) {
    const needed = Math.max(blankAnswers.length, 1)
    return blankAnswers.slice(0, needed).every((v) => v.trim().length > 0)
  }
  if (isCustomQuestion(qtype)) {
    return Object.values(customAnswers ?? {}).some((v) => v.trim().length > 0)
  }
  return textAnswer.trim().length > 0
}

export function buildUserAnswerPayload(
  qtype: string | undefined,
  selectedOption: string | null,
  textAnswer: string,
  blankAnswers: string[],
  customAnswers?: Record<string, string>
): string {
  if (isChoiceQuestion(qtype)) return selectedOption!
  if (isFillBlankQuestion(qtype)) return serializeBlankAnswers(blankAnswers.map((v) => v.trim()))
  if (isCustomQuestion(qtype)) return JSON.stringify(customAnswers ?? {})
  return textAnswer.trim()
}
