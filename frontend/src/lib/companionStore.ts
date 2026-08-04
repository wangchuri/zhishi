/**
 * 伴学本地存储（预览阶段）
 * 阅读进度 / tip（划选笔记）/ 重点页标记 先存在 localStorage，
 * 后续接入后端（UserNote + 文档/页关联 + 用户标记）时替换为 API 调用。
 */

export interface CompanionTip {
  id: string
  page_number: number
  title: string
  content: string
  created_at: string
}

const PROGRESS_KEY = "zhishi_comp_progress"
const TIPS_KEY = "zhishi_comp_tips"
const MARKS_KEY = "zhishi_comp_marks"

function safeGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function safeSet(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

// ─── 阅读进度 ──────────────────────────────────────

export function getProgress(docId: string): number | null {
  const map = safeGet<Record<string, number>>(PROGRESS_KEY, {})
  return map[docId] ?? null
}

export function setProgress(docId: string, page: number) {
  const map = safeGet<Record<string, number>>(PROGRESS_KEY, {})
  map[docId] = page
  safeSet(PROGRESS_KEY, map)
}

// ─── tip（笔记） ──────────────────────────────────

export function getTips(docId: string): CompanionTip[] {
  const map = safeGet<Record<string, CompanionTip[]>>(TIPS_KEY, {})
  return map[docId] ?? []
}

export function getTipCount(docId: string): number {
  return getTips(docId).length
}

export function addTip(
  docId: string,
  tip: Omit<CompanionTip, "id" | "created_at">
): CompanionTip {
  const full: CompanionTip = {
    ...tip,
    id: `tip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    created_at: new Date().toISOString(),
  }
  const map = safeGet<Record<string, CompanionTip[]>>(TIPS_KEY, {})
  map[docId] = [full, ...(map[docId] ?? [])]
  safeSet(TIPS_KEY, map)
  return full
}

// ─── 重点页标记 ────────────────────────────────────

export function getMarkedPages(docId: string): number[] {
  const map = safeGet<Record<string, number[]>>(MARKS_KEY, {})
  return map[docId] ?? []
}

export function isPageMarked(docId: string, page: number): boolean {
  return getMarkedPages(docId).includes(page)
}

export function toggleMarkedPage(docId: string, page: number): number[] {
  const list = getMarkedPages(docId)
  const next = list.includes(page)
    ? list.filter((p) => p !== page)
    : [...list, page]
  const map = safeGet<Record<string, number[]>>(MARKS_KEY, {})
  map[docId] = next
  safeSet(MARKS_KEY, map)
  return next
}
