import type { QuizSessionQuestion } from "@/types"

export const QUESTION_TYPE_LABEL: Record<string, string> = {
  single_choice: "选择题",
  multiple_choice: "多选题",
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
    const parts = parseBlankAnswers(correctAnswer).map(wrapMathIfNeeded)
    if (parts.length > 1) return parts.map((p, i) => `（${i + 1}）${p}`).join("　")
    return parts[0] ?? correctAnswer
  }
  // 非填空也可能存成 JSON 数组（历史数据），别把 ["a","b"] 原样露出去
  const raw = correctAnswer.trim()
  if (raw.startsWith("[")) {
    try {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        return arr.map((x, i) => `（${i + 1}）${wrapMathIfNeeded(String(x))}`).join("　")
      }
    } catch {
      /* 不是合法 JSON，按原文显示 */
    }
  }
  return correctAnswer
}

/**
 * 答案里的裸 LaTeX（如 u_{max}、\frac{1}{2}）没包 $ 时补上，
 * 否则 Markdown 不会当公式渲染，界面上就是一堆下划线花括号。
 *
 * 混合写法要特别处理：`n $\cdot$ u_{max}` 里前段有 $、后面是裸的。
 * 不能拼成 `n $\cdot$$u_{max}$`（两个公式紧邻，remark-math 解析不出来，
 * 实测会整段退回源码），而是去掉内部 $ 整体包一层 → `$n \cdot u_{max}$`。
 */
function wrapMathIfNeeded(text: string): string {
  const t = (text || "").trim()
  if (!t) return t
  if (/[\u4e00-\u9fff]/.test(t)) return t // 含中文的答案不当公式
  if (!/[_^\\{}]/.test(t)) return t // 完全不像数学
  if (/^\$[^$]*\$$/.test(t)) return t // 已经是完整的一段公式
  return `$${t.replace(/\$/g, "").trim()}$`
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
