/**
 * 伴学本地存储
 * 阅读进度 / 重点页标记 存在 localStorage。
 * tip 已升级为后端笔记（user_notes），见 notesApi。
 */

const PROGRESS_KEY = "zhishi_comp_progress"
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
