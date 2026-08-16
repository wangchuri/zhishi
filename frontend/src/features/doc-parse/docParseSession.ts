import type { DocParsePreview } from "@/lib/api"

export interface EditablePage {
  page: number
  text: string
  saved: string
  dirty: boolean
}

export interface DocParseSession {
  preview: DocParsePreview
  pdfBytes: ArrayBuffer
  pages: EditablePage[]
  editing: Record<number, boolean>
}

const STORAGE_KEY = "zhishi:doc-parse-session"

function isDetached(buf: ArrayBuffer): boolean {
  try {
    new Uint8Array(buf)
    return false
  } catch {
    return true
  }
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

const memoryStore: { session: DocParseSession | null } = { session: null }

/** 保存会话：先写内存（保证路由切换不丢），再尽力写 sessionStorage（刷新可恢复）。 */
export function saveDocParseSession(session: DocParseSession) {
  memoryStore.session = session
  try {
    if (isDetached(session.pdfBytes)) {
      // pdf.js 可能已 transfer 该 buffer，跳过 sessionStorage 持久化（内存仍保留引用）
      sessionStorage.removeItem(STORAGE_KEY)
      return
    }
    const serialized = {
      preview: session.preview,
      pages: session.pages,
      editing: session.editing,
      pdfBase64: bufferToBase64(session.pdfBytes),
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
    const s = memoryStore.session
    // memoryStore 中的 pdfBytes 可能已被 pdf.js transfer（detached），此时不可用
    if (isDetached(s.pdfBytes)) {
      memoryStore.session = null
    } else {
      return s
    }
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as {
      preview: DocParsePreview
      pages: EditablePage[]
      editing: Record<number, boolean>
      pdfBase64: string
    }
    const session: DocParseSession = {
      preview: parsed.preview,
      pages: parsed.pages,
      editing: parsed.editing ?? {},
      pdfBytes: base64ToBuffer(parsed.pdfBase64),
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
