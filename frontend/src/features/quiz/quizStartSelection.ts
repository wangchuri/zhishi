/** 刷题浮窗的选择模型：纯函数（可单测），组件只负责渲染。 */

import type { Question } from "@/types"

export const QUIZ_TYPE_LABELS: Record<string, string> = {
  single_choice: "单选题",
  multiple_choice: "多选题",
  fill_blank: "填空题",
  short_answer: "简答题",
  application: "应用题",
  custom: "自定义题",
  material: "材料题",
}

/** 题型桶固定顺序；material 是「材料题」（按 material_id 归桶，占一整段材料） */
export const QUIZ_TYPE_KEYS = [
  "single_choice",
  "multiple_choice",
  "fill_blank",
  "short_answer",
  "application",
  "custom",
  "material",
]

export const DIFFICULTY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: "简单" },
  { value: 2, label: "中等" },
  { value: 3, label: "困难" },
]

export type QuizStartSelection = {
  /** 空 = 全部章节（含未归类章节） */
  chapterIds: string[]
  /** 空 = 全部题型 */
  types: string[]
  /** 空 = 不限难度（含未标注的老题） */
  difficulties: number[]
  /** 空 = 全部知识点 */
  tags: string[]
  /** 0 = 全部（仅「均衡」模式使用） */
  count: number
  distribute: "balanced" | "custom"
  /** 「自定义」模式：每种题型各抽几题（含 material） */
  typeCounts: Record<string, number>
}

export function emptyQuizStartSelection(defaultCount = 10): QuizStartSelection {
  return {
    chapterIds: [],
    types: [],
    difficulties: [],
    tags: [],
    count: defaultCount,
    distribute: "balanced",
    typeCounts: {},
  }
}

/** 题目归桶：材料子题统一算「材料题」 */
export function questionBucket(q: Question): string {
  if (q.material_id) return "material"
  return q.question_type || "single_choice"
}

export function questionMatchesSelection(q: Question, sel: QuizStartSelection): boolean {
  if (sel.chapterIds.length && !(q.chapter_id && sel.chapterIds.includes(q.chapter_id))) return false
  if (sel.types.length && !sel.types.includes(questionBucket(q))) return false
  // 勾了具体难度时，未标注（null）的老题不入选
  if (sel.difficulties.length && (q.difficulty == null || !sel.difficulties.includes(q.difficulty))) {
    return false
  }
  if (sel.tags.length) {
    const tags = new Set(q.tags || [])
    if (!sel.tags.some((t) => tags.has(t))) return false
  }
  return true
}

/** 只按「章节 / 题型 / 难度 / 知识点」过滤（不看数量）：浮窗里的实时「约 N 题」 */
export function countQuizSelection(questions: Question[], sel: QuizStartSelection): number {
  return (questions || []).filter((q) => questionMatchesSelection(q, sel)).length
}

/** 每桶题数，用于 chip 上的角标 */
export function countByBucket(questions: Question[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const q of questions || []) {
    const k = questionBucket(q)
    out[k] = (out[k] || 0) + 1
  }
  return out
}

export function countByDifficulty(questions: Question[]): Record<number, number> {
  const out: Record<number, number> = {}
  for (const q of questions || []) {
    if (q.difficulty == null) continue
    out[q.difficulty] = (out[q.difficulty] || 0) + 1
  }
  return out
}

export function countByChapter(questions: Question[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const q of questions || []) {
    const cid = (q.chapter_id || "").trim()
    if (!cid) continue
    out[cid] = (out[cid] || 0) + 1
  }
  return out
}

/** 自定义分布实际生效的配额（只算当前勾选的题型；没勾=全部） */
export function effectiveTypeCounts(sel: QuizStartSelection): Record<string, number> {
  const allowed = sel.types.length ? new Set(sel.types) : null
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(sel.typeCounts || {})) {
    const n = Number(v) || 0
    if (n > 0 && (!allowed || allowed.has(k))) out[k] = n
  }
  return out
}

/** 自定义分布时本次会抽几题 */
export function customCountTotal(sel: QuizStartSelection): number {
  return Object.values(effectiveTypeCounts(sel)).reduce((sum, n) => sum + (Number(n) || 0), 0)
}

/** 本次刷几题（用于按钮文案） */
export function quizStartTotal(sel: QuizStartSelection, matched: number): number {
  if (sel.distribute === "custom") return customCountTotal(sel)
  if (sel.count > 0) return Math.min(sel.count, matched)
  return matched
}

/** 难度标签：1=简单 2=中等 3=困难 */
export const DIFFICULTY_LABELS: Record<number, string> = {
  1: "简单",
  2: "中等",
  3: "困难",
}

/** 一句话说明「这次会刷什么」，放在浮窗底部（让用户点之前就知道结果） */
export function describeSelection(
  sel: QuizStartSelection,
  matched: number,
  opts: { chapterTitles?: Record<string, string> } = {},
): string {
  const parts: string[] = []

  if (sel.chapterIds.length === 0) {
    parts.push("全书")
  } else if (sel.chapterIds.length === 1) {
    parts.push(opts.chapterTitles?.[sel.chapterIds[0]] || "1 个章节")
  } else {
    parts.push(`${sel.chapterIds.length} 个章节`)
  }

  if (sel.types.length === 0) {
    parts.push("全部题型")
  } else if (sel.types.length === 1) {
    parts.push(QUIZ_TYPE_LABELS[sel.types[0]] || sel.types[0])
  } else {
    parts.push(`${sel.types.length} 种题型`)
  }

  if (sel.difficulties.length === 0) {
    parts.push("不限难度")
  } else {
    parts.push(sel.difficulties.map((d) => DIFFICULTY_LABELS[d] || String(d)).join(" + "))
  }

  if (sel.tags.length > 0) {
    parts.push(sel.tags.length === 1 ? `知识点「${sel.tags[0]}」` : `${sel.tags.length} 个知识点`)
  }

  parts.push(`共 ${quizStartTotal(sel, matched)} 题`)
  return parts.join(" · ")
}

/** 组装创建会话语义（父组件再补 document_id / group_id / title） */
export function buildQuizStartBody(
  sel: QuizStartSelection,
  scope: { documentId?: string; groupId?: string; title?: string } = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (scope.documentId) body.document_id = scope.documentId
  if (scope.groupId) body.group_id = scope.groupId
  if (scope.title) body.title = scope.title
  if (sel.chapterIds.length) body.chapter_ids = sel.chapterIds
  if (sel.types.length) body.question_types = sel.types
  if (sel.difficulties.length) body.difficulties = sel.difficulties
  if (sel.tags.length) body.tags = sel.tags

  if (sel.distribute === "custom") {
    const counts = effectiveTypeCounts(sel)
    if (Object.keys(counts).length) body.type_counts = counts
  } else {
    if (sel.count > 0) body.count = sel.count
    body.distribute = "balanced"
  }
  return body
}
