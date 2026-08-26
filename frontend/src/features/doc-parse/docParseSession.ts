import type { DocParsePreview } from "@/lib/api"

export interface EditablePage {
  page: number
  text: string
  saved: string
  dirty: boolean
}

export interface DocParseSession {
  preview: DocParsePreview
  pages: EditablePage[]
  editing: Record<number, boolean>
}

const STORAGE_KEY = "zhishi:doc-parse-session"

const memoryStore: { session: DocParseSession | null } = { session: null }

/** 保存会话：先写内存（保证路由切换不丢），再尽力写 sessionStorage（刷新可恢复）。 */
export function saveDocParseSession(session: DocParseSession) {
  memoryStore.session = session
  try {
    const serialized = {
      preview: session.preview,
      pages: session.pages,
      editing: session.editing,
    }
    const json = JSON.stringify(serialized)
    if (json.length < 4 * 1024 * 1024) {
      sessionStorage.setItem(STORAGE_KEY, json)
    } else {
      sessionStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    sessionStorage.removeItem(STORAGE_KEY)
  }
}

/** 读取会话：优先内存，其次 sessionStorage。无则返回 null。 */
export function loadDocParseSession(): DocParseSession | null {
  if (memoryStore.session) {
    return memoryStore.session
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as {
      preview: DocParsePreview
      pages: EditablePage[]
      editing: Record<number, boolean>
    }
    const session: DocParseSession = {
      preview: parsed.preview,
      pages: parsed.pages ?? [],
      editing: parsed.editing ?? {},
    }
    memoryStore.session = session
    return session
  } catch {
    return null
  }
}

export function clearDocParseSession() {
  memoryStore.session = null
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* noop */
  }
}
