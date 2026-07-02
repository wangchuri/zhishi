/**
 * 知拾 Web 端 — API 客户端
 * 内网穿透地址：https://zhishi-backend.ximocy.com
 */

const API_BASE = "https://zhishi-backend.ximocy.com"

let _token: string | null = null

export function setToken(token: string | null) {
  _token = token
  if (token) {
    localStorage.setItem("zhishi_token", token)
  } else {
    localStorage.removeItem("zhishi_token")
  }
}

export function getToken(): string | null {
  if (!_token) {
    _token = localStorage.getItem("zhishi_token")
  }
  return _token
}

async function request<T = any>(
  method: string,
  path: string,
  body?: any,
  isFormData?: boolean
): Promise<T> {
  const url = `${API_BASE}${path}`
  const headers: Record<string, string> = {}
  const token = getToken()

  if (!isFormData) {
    headers["Content-Type"] = "application/json"
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  }

  const res = await fetch(url, {
    method,
    headers,
    body: isFormData ? body : body ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401) {
    setToken(null)
    throw new Error("登录已过期，请重新登录")
  }

  if (!res.ok) {
    const errText = await res.text()
    let detail = errText
    try {
      const errJson = JSON.parse(errText)
      detail = errJson.detail || errText
    } catch { /* not JSON */ }
    throw new Error(detail)
  }

  return res.json()
}

// ─── Auth ──────────────────────────────────────────────

export const authApi = {
  register(email: string, password: string, nickname: string) {
    return request<any>("POST", "/api/v1/auth/register", {
      email, password, nickname,
    })
  },

  login(email: string, password: string) {
    const formData = new URLSearchParams()
    formData.append("username", email)
    formData.append("password", password)
    return fetch(`${API_BASE}/api/v1/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData.toString(),
    }).then(res => {
      if (!res.ok) return res.json().then(e => { throw new Error(e.detail || "登录失败") })
      return res.json()
    })
  },

  getMe() {
    return request<any>("GET", "/api/v1/auth/users/me")
  },
}

// ─── Chat ──────────────────────────────────────────────

export const chatApi = {
  send(data: { content: string; session_id?: string; stream: boolean }) {
    return request<any>("POST", "/api/v1/chat", data)
  },

  /** SSE 流式聊天 — 返回 ReadableStream 读取器 */
  async sendStream(
    content: string,
    session_id?: string,
    onChunk?: (data: any) => void
  ): Promise<string> {
    const url = `${API_BASE}/api/v1/chat`
    const token = getToken()
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ content, session_id, stream: true }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(err)
    }

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
            const json = JSON.parse(line.slice(6))
            if (json.content) {
              fullContent += json.content
            }
            if (onChunk) onChunk(json)
          } catch { /* 忽略解析错误 */ }
        }
      }
    }

    return fullContent
  },

  getHistory(sessionId: string) {
    return request<any[]>("GET", `/api/v1/chat/history?session_id=${sessionId}`)
  },

  getSessions() {
    return request<any>("GET", "/api/v1/chat/sessions")
  },

  deleteSession(sessionId: string) {
    return request<any>("DELETE", `/api/v1/chat/sessions/${sessionId}`)
  },
}

// ─── KB (知识库) ───────────────────────────────────────

export const kbApi = {
  upload(file: File) {
    const formData = new FormData()
    formData.append("file", file)
    return request<any>("POST", "/api/v1/kb/upload", formData, true)
  },

  listDocuments(page = 1, limit = 20) {
    return request<any>("GET", `/api/v1/kb/documents?page=${page}&limit=${limit}`)
  },

  getDocumentStatus(docId: string) {
    return request<any>("GET", `/api/v1/kb/documents/${docId}/status`)
  },

  deleteDocument(docId: string) {
    return request<any>("DELETE", `/api/v1/kb/documents/${docId}`)
  },

  getDocumentContent(docId: string) {
    return request<any>("GET", `/api/v1/kb/documents/${docId}/content`)
  },

  getConfig() {
    return request<any>("GET", "/api/v1/kb/config")
  },
}

// ─── Dashboard (首页建议) ────────────────────────────

export const dashboardApi = {
  getSuggestions() {
    return request<any>("GET", "/api/v1/dashboard/suggestions")
  },
}

// ─── KT (知识追踪 / LEKT) ──────────────────────────────

export const ktApi = {
  correct(states: Array<{ skill_name: string; value: number }>) {
    return request<any>("POST", "/api/v1/kt/correct", { states })
  },

  evaluate(states: Array<{ skill_name: string; value: number }>) {
    return request<any>("POST", "/api/v1/kt/evaluate", { states })
  },

  recommendLearningPath(
    states: Array<{ skill_name: string; value: number }>,
    topK = 5
  ) {
    return request<any>("POST", "/api/v1/kt/learning-path", {
      states,
      top_k: topK,
    })
  },

  getPrerequisites(skillName: string) {
    return request<any>("POST", "/api/v1/kt/prerequisites", {
      skill_name: skillName,
    })
  },

  getSkillGraph() {
    return request<any>("GET", "/api/v1/kt/skill-graph")
  },
}
