/**
 * 知拾 Web 端 — API 客户端
 * 去登录模式：后端地址由用户在设置页输入服务器 IP，保存在 localStorage
 */

import type {
  Citation,
  DocumentContentMeta,
  DocumentPageDetail,
  DocumentPageList,
  PageQuestionResult,
} from "@/types"

const API_BASE_STORAGE_KEY = "zhishi_api_base"
const DEFAULT_API_BASE = import.meta.env.VITE_API_BASE ?? ""

// ─── 动态服务器地址配置（去登录模式） ─────────────────────
// 用户输入服务器的 IP/域名，保存在 localStorage；
// 所有 API 请求都基于该地址发起，每次运行/连接时先做健康检测。

export function normalizeApiBase(input: string): string {
  let base = (input || "").trim()
  if (!base) return ""
  base = base.replace(/\/+$/, "")
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`
  }
  return base
}

export function getStoredApiBase(): string {
  const stored = localStorage.getItem(API_BASE_STORAGE_KEY)
  return stored ? normalizeApiBase(stored) : ""
}

export function setApiBase(input: string) {
  const normalized = normalizeApiBase(input)
  if (normalized) {
    localStorage.setItem(API_BASE_STORAGE_KEY, normalized)
  } else {
    localStorage.removeItem(API_BASE_STORAGE_KEY)
  }
}

export function clearApiBase() {
  localStorage.removeItem(API_BASE_STORAGE_KEY)
}

export function getApiBase(): string {
  const stored = getStoredApiBase()
  if (stored) return stored
  return DEFAULT_API_BASE || "http://127.0.0.1:8765"
}

export function isServerConfigured(): boolean {
  return !!getStoredApiBase() || !!DEFAULT_API_BASE
}

/** 健康检测：探测服务器 /health 端点，返回是否正常 */
export async function checkServerHealth(
  input?: string
): Promise<{ ok: boolean; status: string; message: string; detail?: any }> {
  const base = input ? normalizeApiBase(input) : getApiBase()
  if (!base) {
    return { ok: false, status: "error", message: "请输入服务器地址" }
  }
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(`${base}/health`, { signal: controller.signal })
    clearTimeout(timeout)
    if (res.ok) {
      const data = await res.json().catch(() => null)
      return {
        ok: true,
        status: data?.status ?? "ok",
        message: data?.status === "ok" ? "服务器运行正常" : "服务器可用（部分组件未就绪）",
        detail: data,
      }
    }
    return { ok: false, status: "error", message: `服务器返回异常状态码 ${res.status}` }
  } catch (e: any) {
    if (e?.name === "AbortError") {
      return { ok: false, status: "error", message: "连接超时，请检查地址与网络" }
    }
    return { ok: false, status: "error", message: `无法连接服务器：${e?.message || "未知错误"}` }
  }
}

export function getThumbnailUrl(docId: string): string {
  return `${getApiBase()}/api/v1/kb/documents/${docId}/thumbnail`
}

async function request<T = any>(
  method: string,
  path: string,
  body?: any,
  isFormData?: boolean
): Promise<T> {
  const url = `${getApiBase()}${path}`
  const headers: Record<string, string> = {}

  if (!isFormData) {
    headers["Content-Type"] = "application/json"
  }

  const res = await fetch(url, {
    method,
    headers,
    body: isFormData ? (body as BodyInit) : body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const errText = await res.text()
    let detail = errText
    try {
      const errJson = JSON.parse(errText)
      detail = errJson.detail || errText
    } catch {
      /* not JSON */
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail))
  }

  if (res.status === 204) {
    return undefined as T
  }

  return res.json()
}

async function requestBlob(path: string): Promise<Blob> {
  const url = `${getApiBase()}${path}`
  const res = await fetch(url, { method: "GET" })

  if (!res.ok) {
    const errText = await res.text()
    let detail = errText
    try {
      const errJson = JSON.parse(errText)
      detail = errJson.detail || errText
    } catch {
      /* not JSON */
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail))
  }

  return res.blob()
}

/** 解析 SSE 流，逐条回调 JSON data */
export async function readSseStream(
  res: Response,
  onChunk?: (data: Record<string, unknown>) => void
): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) throw new Error("无法建立流式连接")

  const decoder = new TextDecoder()
  let fullContent = ""
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const json = JSON.parse(line.slice(6)) as Record<string, unknown>
          if (typeof json.content === "string") {
            fullContent += json.content
          }
          onChunk?.(json)
        } catch {
          /* 忽略解析错误 */
        }
      }
    }
  }

  return fullContent
}

// ─── Chat ──────────────────────────────────────────────

export interface ChatStreamOptions {
  content: string
  session_id?: string
  collection_id?: string
  onChunk?: (data: Record<string, unknown>) => void
}

export const chatApi = {
  send(data: {
    content: string
    session_id?: string
    stream: boolean
    collection_id?: string
  }) {
    return request<any>("POST", "/api/v1/chat", data)
  },

  async sendStream(options: ChatStreamOptions): Promise<string> {
    const { content, session_id, collection_id, onChunk } = options
    const res = await fetch(`${getApiBase()}/api/v1/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content,
        session_id,
        collection_id,
        stream: true,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(err)
    }

    return readSseStream(res, onChunk)
  },

  getHistory(sessionId: string) {
    return request<any>("GET", `/api/v1/chat/history?session_id=${sessionId}`)
  },

  getSessions() {
    return request<any>("GET", "/api/v1/chat/sessions")
  },

  deleteSession(sessionId: string) {
    return request<any>("DELETE", `/api/v1/chat/sessions/${sessionId}`)
  },
}

/** 将 chat history 响应规范为消息数组 */
export function normalizeChatHistory(res: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(res)) return res
  if (res && typeof res === "object") {
    const obj = res as Record<string, unknown>
    if (Array.isArray(obj.messages)) return obj.messages as Array<Record<string, unknown>>
    if (Array.isArray(obj.data)) return obj.data as Array<Record<string, unknown>>
  }
  return []
}

// ─── KB (知识库) ───────────────────────────────────────

export const kbApi = {
  listCollections() {
    return request<any>("GET", "/api/v1/kb/collections")
  },

  createCollection(data: { name: string; zone: "study" | "life"; description?: string }) {
    return request<any>("POST", "/api/v1/kb/collections", data)
  },

  updateCollection(collectionId: string, data: { name?: string; description?: string }) {
    return request<any>("PATCH", `/api/v1/kb/collections/${collectionId}`, data)
  },

  upload(file: File, collectionId?: string) {
    const formData = new FormData()
    formData.append("file", file)
    if (collectionId) {
      formData.append("collection_id", collectionId)
    }
    return request<any>("POST", "/api/v1/kb/upload", formData, true)
  },

  listDocuments(page = 1, limit = 20, collectionId?: string) {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (collectionId) params.set("collection_id", collectionId)
    return request<any>("GET", `/api/v1/kb/documents?${params}`)
  },

  getDocumentStatus(batchId: string) {
    return request<any>("GET", `/api/v1/kb/documents/${batchId}/status`)
  },

  deleteDocument(docId: string) {
    return request<any>("DELETE", `/api/v1/kb/documents/${docId}`)
  },

  getDocumentContent(docId: string) {
    return request<DocumentContentMeta>("GET", `/api/v1/kb/documents/${docId}/content`)
  },

  fetchDocumentFile(docId: string) {
    return requestBlob(`/api/v1/kb/documents/${docId}/file`)
  },

  getDocumentSegments(docId: string) {
    return request<any>("GET", `/api/v1/kb/documents/${docId}/segments`)
  },

  getDocumentPages(docId: string) {
    return request<DocumentPageList>("GET", `/api/v1/kb/documents/${docId}/pages`)
  },

  getDocumentPage(docId: string, pageNumber: number) {
    return request<DocumentPageDetail>(
      "GET",
      `/api/v1/kb/documents/${docId}/pages/${pageNumber}`
    )
  },

  getConfig() {
    return request<any>("GET", "/api/v1/kb/config")
  },
}

// ─── Questions ─────────────────────────────────────────

export const questionsApi = {
  generate(data: { document_id?: string; segment_ids?: string[] }) {
    return request<any>("POST", "/api/v1/questions/generate", data)
  },

  list(params: { document_id?: string }) {
    const qs = params.document_id ? `?document_id=${params.document_id}` : ""
    return request<any>("GET", `/api/v1/questions${qs}`)
  },

  generateFromPages(data: {
    document_id: string
    page_numbers: number[]
    questions_per_page?: number
  }) {
    return request<PageQuestionResult>("POST", "/api/v1/questions/generate-from-pages", data)
  },

  generateStream(data: {
    document_id: string
    page_numbers: number[]
    questions_per_page?: number
  }, onChunk: (chunk: { event: string; content?: string; questions?: any[] }) => void): Promise<void> {
    return fetch(`${getApiBase()}/api/v1/questions/generate-stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    }).then(async (res) => {
      if (!res.ok) {
        const err = await res.text()
        throw new Error(err)
      }
      const reader = res.body?.getReader()
      if (!reader) return
      const decoder = new TextDecoder()
      let buffer = ""
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const chunk = JSON.parse(line.slice(6))
              onChunk(chunk)
            } catch { /* ignore parse errors */ }
          }
        }
      }
    })
  },

  get(questionId: string) {
    return request<any>("GET", `/api/v1/questions/${questionId}`)
  },

  extractFromPages(data: { document_id: string; page_numbers: number[] }) {
    return request<PageQuestionResult>("POST", "/api/v1/questions/extract-from-pages", data)
  },

  deleteByDocument(documentId: string) {
    const qs = new URLSearchParams({ document_id: documentId })
    return request<{ deleted_count: number; document_id?: string }>(
      "DELETE",
      `/api/v1/questions?${qs.toString()}`
    )
  },

  deleteBulk(data: {
    document_id?: string
    collection_id?: string
    question_ids?: string[]
  }) {
    return request<{ deleted_count: number }>("DELETE", "/api/v1/questions/bulk", data)
  },
}

// ─── Quiz ──────────────────────────────────────────────

export const quizApi = {
  createSession(data: {
    document_id?: string
    collection_id?: string
    question_ids?: string[]
    title?: string
    filter?: "all" | "undone" | "wrong" | "unknown"
  }) {
    return request<any>("POST", "/api/v1/quiz/sessions", data)
  },

  getSession(sessionId: string) {
    return request<any>("GET", `/api/v1/quiz/sessions/${sessionId}`)
  },

  getRecentActiveSession(documentId: string) {
    return request<any>("GET", `/api/v1/quiz/sessions/recent/by-document/${documentId}`)
  },

  submitAnswer(
    sessionId: string,
    data: {
      question_id: string
      user_answer?: string
      status?: "unknown"
      time_spent_seconds?: number
      request_ai_grade?: boolean
    }
  ) {
    return request<any>("POST", `/api/v1/quiz/sessions/${sessionId}/answers`, data)
  },

  getResults(sessionId: string) {
    return request<any>("GET", `/api/v1/quiz/sessions/${sessionId}/results`)
  },
}

// ─── Tutor ─────────────────────────────────────────────

export const tutorApi = {
  createSession(data: {
    question_id: string
    quiz_session_id?: string
    quiz_answer_id?: string
  }) {
    return request<any>("POST", "/api/v1/tutor/sessions", data)
  },

  getSession(sessionId: string) {
    return request<any>("GET", `/api/v1/tutor/sessions/${sessionId}`)
  },

  sendMessage(sessionId: string, content: string, stream = false) {
    if (stream) {
      return fetch(`${getApiBase()}/api/v1/tutor/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content, stream: true }),
      })
    }
    return request<any>("POST", `/api/v1/tutor/sessions/${sessionId}/messages`, { content, stream: false })
  },

  async sendMessageStream(
    sessionId: string,
    content: string,
    onChunk?: (data: Record<string, unknown>) => void
  ): Promise<string> {
    const res = await tutorApi.sendMessage(sessionId, content, true)
    if (!(res instanceof Response)) throw new Error("流式请求失败")
    if (!res.ok) {
      const err = await res.text()
      throw new Error(err)
    }
    return readSseStream(res, onChunk)
  },
}

// ─── Dashboard ───────────────────────────────────────────

export const dashboardApi = {
  getSuggestions() {
    return request<any>("GET", "/api/v1/dashboard/suggestions")
  },
}

// ─── Analytics (学习分析) ────────────────────────────────

export const analyticsApi = {
  getStats() {
    return request<import("@/types").LearningStats>("GET", "/api/v1/analytics/stats")
  },

  getTagStats(documentId?: string) {
    const qs = documentId ? `?document_id=${documentId}` : ""
    return request<import("@/types").TagStatsResult>("GET", `/api/v1/analytics/tag-stats${qs}`)
  },

  generateLearningReport() {
    return request<{ report: import("@/types").LearningReport; saved_to_notes: boolean }>(
      "POST",
      "/api/v1/analytics/learning-report"
    )
  },
}

// ─── Reports (学习报告) ─────────────────────────────────

export const reportsApi = {
  generate() {
    return request<{ report: import("@/types").LearningReport; saved_to_notes: boolean }>(
      "POST",
      "/api/v1/reports/generate"
    )
  },

  list() {
    return request<import("@/types").LearningReportList>("GET", "/api/v1/reports")
  },

  getLatest() {
    return request<import("@/types").LearningReport>("GET", "/api/v1/reports/latest")
  },

  get(reportId: string) {
    return request<import("@/types").LearningReport>("GET", `/api/v1/reports/${reportId}`)
  },
}

// ─── Training (针对训练) ────────────────────────────────

export const trainingApi = {
  startTargeted(data?: { report_id?: string; force_new?: boolean }) {
    return request<import("@/types").TargetedTrainingResult>(
      "POST",
      "/api/v1/training/targeted/start",
      data ?? {}
    )
  },

  getActiveSession(reportId: string) {
    return request<import("@/types").TargetedTrainingActiveSession | null>(
      "GET",
      `/api/v1/training/targeted/reports/${reportId}/active-session`
    )
  },

  resumeSession(sessionId: string) {
    return request<import("@/types").TargetedTrainingResult>(
      "GET",
      `/api/v1/training/targeted/sessions/${sessionId}`
    )
  },

  sendTutorMessage(agentSessionId: string, content: string, stream = false) {
    if (stream) {
      return fetch(`${getApiBase()}/api/v1/training/targeted/tutor/${agentSessionId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content, stream: true }),
      })
    }
    return request<{ role: string; content: string; agent_session_id: string }>(
      "POST",
      `/api/v1/training/targeted/tutor/${agentSessionId}`,
      { content, stream: false }
    )
  },

  async tutorStream(
    agentSessionId: string,
    content: string,
    onChunk?: (data: Record<string, unknown>) => void
  ): Promise<string> {
    const res = await trainingApi.sendTutorMessage(agentSessionId, content, true)
    if (!(res instanceof Response)) throw new Error("流式请求失败")
    if (!res.ok) {
      const err = await res.text()
      throw new Error(err)
    }
    return readSseStream(res, onChunk)
  },
}

export type { Citation }
