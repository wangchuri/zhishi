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
const NICKNAME_STORAGE_KEY = "zhishi_nickname"
const DEFAULT_API_BASE = import.meta.env.VITE_API_BASE ?? ""

// ─── 本地昵称（每台设备各自取名，无名称时填写） ─────────────

export function getStoredNickname(): string {
  return (localStorage.getItem(NICKNAME_STORAGE_KEY) || "").trim()
}

export function setStoredNickname(name: string) {
  const normalized = (name || "").trim()
  if (normalized) {
    localStorage.setItem(NICKNAME_STORAGE_KEY, normalized)
  } else {
    localStorage.removeItem(NICKNAME_STORAGE_KEY)
  }
}

export function hasNickname(): boolean {
  return !!getStoredNickname()
}

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
  // 后端托管前端时默认同源（相对路径）；独立部署可在设置页配置服务器地址
  return DEFAULT_API_BASE || ""
}

export function getWsUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`
  const base = getApiBase()
  if (base) {
    const u = new URL(base)
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:"
    return `${u.origin}${normalized}`
  }
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${proto}//${window.location.host}${normalized}`
}

/** 生产构建且通过 http(s) 打开：视为后端已托管前端，API 走同源 */
export function isSameOriginHosted(): boolean {
  if (typeof window === "undefined") return false
  if (import.meta.env.DEV) return false
  return window.location.protocol === "http:" || window.location.protocol === "https:"
}

export function isServerConfigured(): boolean {
  return !!getStoredApiBase() || !!DEFAULT_API_BASE || isSameOriginHosted()
}

/** 健康检测：探测服务器 /health 端点，返回是否正常 */
export async function checkServerHealth(
  input?: string
): Promise<{ ok: boolean; status: string; message: string; detail?: any }> {
  const base = input ? normalizeApiBase(input) : getApiBase()
  if (!base && !isSameOriginHosted()) {
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
  crisis?: boolean
  remaining_pages?: string[]
  kickoff?: boolean
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
    const { content, session_id, collection_id, crisis, remaining_pages, kickoff, onChunk } = options
    const res = await fetch(`${getApiBase()}/api/v1/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content,
        session_id,
        collection_id,
        crisis: Boolean(crisis),
        remaining_pages: remaining_pages ?? undefined,
        kickoff: Boolean(kickoff),
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

  upload(file: File, collectionId?: string, forceScanned?: boolean) {
    const formData = new FormData()
    formData.append("file", file)
    if (collectionId) {
      formData.append("collection_id", collectionId)
    }
    if (forceScanned != null) {
      formData.append("force_scanned", String(forceScanned))
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

  getDocumentContent(docId: string, opts?: { metaOnly?: boolean }) {
    const q = opts?.metaOnly ? "?meta_only=true" : ""
    return request<DocumentContentMeta>("GET", `/api/v1/kb/documents/${docId}/content${q}`)
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

  listDocumentImages(docId: string, page?: number | null) {
    const qs = page != null && page > 0 ? `?page=${page}` : ""
    return request<{ document_id: string; images: DocumentImageItem[] }>(
      "GET",
      `/api/v1/kb/documents/${encodeURIComponent(docId)}/images${qs}`,
    )
  },

  getLearningPath(docId: string) {
    return request<import("@/types").LearningPathResult>(
      "GET",
      `/api/v1/kb/documents/${docId}/learning-path`
    )
  },

  generateLearningPath(docId: string) {
    return request<import("@/types").LearningPathResult>(
      "POST",
      `/api/v1/kb/documents/${docId}/learning-path`
    )
  },

  getConfig() {
    return request<any>("GET", "/api/v1/kb/config")
  },

  /** 导出书本+题库 zip 包，并触发浏览器下载 */
  async exportPackage(
    docId: string,
    displayName?: string,
    opts?: { includeOriginal?: boolean }
  ) {
    const q = opts?.includeOriginal ? "?include_original=true" : ""
    const blob = await requestBlob(`/api/v1/kb/documents/${docId}/export${q}`)
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${displayName || "document"}-书本包.zip`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  },

  /** 导入书本+题库 zip 包（后端先合并数据库再向量化，成功才算导入成功） */
  importPackage(file: File, collectionId?: string) {
    const formData = new FormData()
    formData.append("file", file)
    if (collectionId) {
      formData.append("collection_id", collectionId)
    }
    return request<{
      status: string
      document_id?: string
      page_count?: number
      imported_questions?: number
      reused_questions?: number
      has_original?: boolean
    }>(
      "POST",
      "/api/v1/kb/import",
      formData,
      true
    )
  },
}

// ─── 扫描件解析 ────────────────────────────────────────

export interface DocParsePage {
  page: number
  text: string
}

export interface DocParsePreview {
  filename: string
  total_pages: number
  pages: DocParsePage[]
  images: Record<string, string>
}

export interface DocParseImportResult {
  message: string
  status: string
  document_id?: string
  id?: string
  file_name?: string
  collection_id?: string
  segment_status?: string
  indexing_status?: string
}

export const docParseApi = {
  /** 上传 PDF，MinerU 解析并返回按页 md + 图片（不落库） */
  preview(file: File) {
    const formData = new FormData()
    formData.append("file", file)
    return request<DocParsePreview>("POST", "/api/v1/parse/preview", formData, true)
  },

  /** 编辑后的 md 直接导入知识库（跳过重新解析，保留分页结构） */
  importMarkdown(
    markdown: string,
    filename: string,
    collectionId?: string,
    images?: Record<string, string>
  ) {
    const formData = new FormData()
    formData.append("markdown", markdown)
    formData.append("filename", filename)
    if (collectionId) {
      formData.append("collection_id", collectionId)
    }
    if (images && Object.keys(images).length > 0) {
      formData.append("images", JSON.stringify(images))
    }
    return request<DocParseImportResult>(
      "POST",
      "/api/v1/parse/import-md",
      formData,
      true
    )
  },

  /** md zip 包导入知识库（合并为一个文档） */
  importZip(file: File, collectionId?: string) {
    const formData = new FormData()
    formData.append("file", file)
    if (collectionId) {
      formData.append("collection_id", collectionId)
    }
    return request<DocParseImportResult>(
      "POST",
      "/api/v1/parse/import-zip",
      formData,
      true
    )
  },
}

/** 生成文档图片的完整 URL（图床式引用，供 md 图片渲染） */
export type DocumentImageItem = {
  file_name: string
  page_num: number
  url_path: string
}

export function documentImageUrl(docId: string, filename: string): string {
  const base = getApiBase().replace(/\/$/, "")
  return `${base}/api/v1/kb/documents/${encodeURIComponent(docId)}/images/${encodeURIComponent(filename)}`
}

/** 文档图床 base（MarkdownWithMath imageBaseUrl） */
export function documentImageBase(docId: string): string {
  const base = getApiBase().replace(/\/$/, "")
  return `${base}/api/v1/kb/documents/${encodeURIComponent(docId)}/images`
}

// ─── Questions ─────────────────────────────────────────

export const questionsApi = {
  list(params: { document_id?: string; collection_id?: string; keyword?: string }) {
    const qs = new URLSearchParams()
    if (params.document_id) qs.set("document_id", params.document_id)
    if (params.collection_id) qs.set("collection_id", params.collection_id)
    if (params.keyword) qs.set("keyword", params.keyword)
    const q = qs.toString()
    return request<any>("GET", `/api/v1/questions${q ? `?${q}` : ""}`)
  },

  generateFromPages(data: {
    document_id: string
    page_numbers: number[]
    questions_per_page?: number
  }) {
    return request<PageQuestionResult>("POST", "/api/v1/questions/generate-from-pages", data)
  },

  generateWholeDocument(data: {
    document_id: string
    questions_per_page?: number
  }) {
    return request<PageQuestionResult>(
      "POST",
      "/api/v1/questions/generate-whole-document",
      {
        document_id: data.document_id,
        questions_per_page: data.questions_per_page ?? 1,
      }
    )
  },

  listJobs() {
    return request<{ jobs: import("@/types").QuestionGenJob[] }>("GET", "/api/v1/questions/jobs")
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
    resume?: boolean
    task_id?: string
  }) {
    return request<any>("POST", "/api/v1/quiz/sessions", data)
  },

  getSession(sessionId: string) {
    return request<any>("GET", `/api/v1/quiz/sessions/${sessionId}`)
  },

  listActiveSessions() {
    return request<{ sessions: import("@/types").QuizSession[] }>("GET", "/api/v1/quiz/active-sessions")
  },

  completeSession(sessionId: string) {
    return request<any>("POST", `/api/v1/quiz/sessions/${sessionId}/complete`)
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

  grade(data: {
    question_id: string
    user_answer?: string
    status?: "unknown"
    document_id?: string
    chat_message_id?: string
    request_ai_grade?: boolean
  }) {
    return request<any>("POST", "/api/v1/quiz/grade", data)
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

export const tasksApi = {
  getGoal() {
    return request<{
      id: string
      text: string
      attributes?: Record<string, unknown> | null
      valid_until?: string | null
      status: string
    } | null>("GET", "/api/v1/me/goal")
  },

  putGoal(data: { text: string; attributes?: Record<string, unknown>; valid_until?: string | null }) {
    return request<any>("PUT", "/api/v1/me/goal", data)
  },

  getToday() {
    return request<import("@/types").TodayTasksResult>("GET", "/api/v1/tasks/today")
  },

  ensureToday() {
    return request<import("@/types").TodayTasksResult>("POST", "/api/v1/tasks/today/ensure")
  },

  getHistory(days = 60) {
    return request<import("@/types").TaskHistoryResult>(
      "GET",
      `/api/v1/tasks/history?days=${encodeURIComponent(String(days))}`,
    )
  },

  restore(taskId: string) {
    return request<import("@/types").RestoreTaskResult>(
      "POST",
      `/api/v1/tasks/${encodeURIComponent(taskId)}/restore`,
    )
  },
}

export type UserProfile = {
  user_id: number
  nickname?: string | null
  role?: string | null
  onboarding_status: string
  has_goal: boolean
  goal?: { id: string; text: string; status?: string } | null
  onboarding_session_id?: string | null
  tina_style?: "default" | "tsundere" | string
  /** 每日最多布置几条任务；空/未设 = 不限制 */
  task_max_daily_count?: number | null
  /** 今日学习满多少分钟后不再布置；空/未设 = 不限制 */
  task_max_study_minutes?: number | null
}

export const profileApi = {
  get() {
    return request<UserProfile>("GET", "/api/v1/me/profile")
  },
  put(data: {
    nickname?: string
    role?: string
    onboarding_status?: string
    tina_style?: string
    task_max_daily_count?: number | null
    task_max_study_minutes?: number | null
  }) {
    return request<UserProfile>("PUT", "/api/v1/me/profile", data)
  },
}

export type MineruSettings = {
  mode: "local" | "cloud"
  api_token: string
  api_base: string
  model_version: "pipeline" | "vlm"
  config_path?: string
}

export const systemApi = {
  getMineru() {
    return request<MineruSettings>("GET", "/api/v1/system/mineru")
  },
  putMineru(data: Partial<MineruSettings>) {
    return request<MineruSettings>("PUT", "/api/v1/system/mineru", data)
  },
}

export type OnboardingUiItem = {
  type: string
  id?: string
  status?: string
  goal?: string
  nickname?: string
  role?: string
}

export const onboardingApi = {
  getSession(replay = false) {
    const q = replay ? "?replay=1" : ""
    return request<{
      session_id: string
      profile: UserProfile
      messages: Array<Record<string, unknown>>
      needs_kickoff: boolean
    }>(`GET`, `/api/v1/onboarding/session${q}`)
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

  /** 学习时长：活跃 + 刷题（今日 + 累计） */
  getActivity() {
    return request<import("@/types").ActivityStats>("GET", "/api/v1/analytics/activity")
  },

  /** 打卡统计：累计天数 / 连续 / 热力图 */
  getStreak() {
    return request<import("@/types").StreakStats>("GET", "/api/v1/analytics/streak")
  },

  /** 心跳上报活跃秒数（前端计时，单次上限 90s） */
  reportActivity(seconds: number) {
    return request<import("@/types").ActivityStats>(
      "POST",
      "/api/v1/analytics/activity",
      { seconds }
    )
  },
}

// ─── Plans (学习计划) ──────────────────────────────────

export const plansApi = {
  list() {
    return request<{ plans: import("@/types").StudyPlan[] }>("GET", "/api/v1/plans")
  },

  create(data: { title: string; goal?: string }) {
    return request<import("@/types").StudyPlan>("POST", "/api/v1/plans", data)
  },

  removePlan(id: string) {
    return request<{ deleted: boolean }>("DELETE", `/api/v1/plans/${id}`)
  },

  /** 某月任务（日历视图数据源） */
  listTasksByMonth(month: string) {
    return request<import("@/types").PlanTask[]>(
      "GET",
      `/api/v1/plans/tasks/month?month=${encodeURIComponent(month)}`
    )
  },

  createTask(planId: string, data: { title: string; due_date?: string }) {
    return request<import("@/types").PlanTask>(
      "POST",
      `/api/v1/plans/${planId}/tasks`,
      data
    )
  },

  updateTask(id: string, data: { title?: string; due_date?: string; done?: boolean }) {
    return request<import("@/types").PlanTask>("PATCH", `/api/v1/plans/tasks/${id}`, data)
  },

  removeTask(id: string) {
    return request<{ deleted: boolean }>("DELETE", `/api/v1/plans/tasks/${id}`)
  },
}

// ─── Achievements (成就) ────────────────────────────────

export const achievementsApi = {
  /** 成就墙：返回全部成就 + 本次新解锁（惰性判定，达标即解锁） */
  list() {
    return request<import("@/types").AchievementList>("GET", "/api/v1/achievements")
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

// ─── Companion (伴学对话，按书持久化) ───────────────────────

export interface CompanionMessage {
  role: string
  content: string
  created_at?: string
  citations?: Citation[]
}

export const companionApi = {
  /** 伴学 SSE 流式对话，自动附带当前页码/页内容 */
  async sendStream(options: {
    document_id: string
    content: string
    page_number?: number | null
    page_content?: string
    onChunk?: (data: Record<string, unknown>) => void
  }): Promise<string> {
    const { document_id, content, page_number, page_content, onChunk } = options
    const res = await fetch(`${getApiBase()}/api/v1/companion/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        document_id,
        content,
        page_number: page_number ?? null,
        page_content: page_content ?? "",
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(err)
    }

    return readSseStream(res, onChunk)
  },

  /** 获取某本书的伴学对话历史 */
  getHistory(documentId: string) {
    return request<{ document_id: string; document_name: string; updated_at?: string; messages: CompanionMessage[] }>(
      "GET",
      `/api/v1/companion/sessions/${documentId}`
    )
  },
}

export type { Citation }

// ─── Notes (笔记 / tip) ─────────────────────────────────

export interface NoteItem {
  id: string
  title?: string | null
  content_md?: string | null
  collection_id?: string | null
  document_id?: string | null
  document_name?: string | null
  page_number?: number | null
  /** 用户给 tip 打的分类 tag，不是知识点 tag */
  tags?: string[]
  note_type: string
  created_at?: string
  updated_at?: string
}

export interface NoteListResult {
  notes: NoteItem[]
  total: number
}

export const notesApi = {
  /** 保存一条伴学 tip 到后端笔记 */
  saveTip(data: {
    document_id?: string | null
    page_number?: number | null
    title: string
    content: string
    tags?: string[]
  }) {
    return request<NoteItem>("POST", "/api/v1/notes/tips", data)
  },

  /** 列出笔记（可按文档 / 类型过滤） */
  list(params?: { document_id?: string; note_type?: string; limit?: number }) {
    const qs = new URLSearchParams()
    if (params?.document_id) qs.set("document_id", params.document_id)
    if (params?.note_type) qs.set("note_type", params.note_type)
    if (params?.limit != null) qs.set("limit", String(params.limit))
    const suffix = qs.toString() ? `?${qs.toString()}` : ""
    return request<NoteListResult>("GET", `/api/v1/notes${suffix}`)
  },

  get(noteId: string) {
    return request<NoteItem>("GET", `/api/v1/notes/${encodeURIComponent(noteId)}`)
  },

  listTipTags() {
    return request<{ tags: string[] }>("GET", "/api/v1/notes/tip-tags")
  },

  /** 列出某本书的全部 tip（用于阅读页面板 / 卡片计数） */
  listTips(documentId: string) {
    return request<NoteListResult>("GET", `/api/v1/notes/tips/${documentId}`)
  },
}