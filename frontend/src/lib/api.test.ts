/**
 * API 客户端测试 — 校验每个请求的 method / URL / body 与后端路由对齐。
 * 后端路由表见 backend/app/api/v1/*.py。
 */
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  chatApi,
  kbApi,
  quizApi,
  tutorApi,
  dashboardApi,
  analyticsApi,
  reportsApi,
  trainingApi,
  questionsApi,
  companionApi,
  notesApi,
  normalizeApiBase,
  getApiBase,
  setApiBase,
  checkServerHealth,
  getThumbnailUrl,
} from "./api"

const BASE = "http://127.0.0.1:8765"

type FetchCall = { method: string; url: string; body?: unknown }

function installFetchMock() {
  const calls: FetchCall[] = []
  const record = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method || "GET").toUpperCase()
    let body: unknown
    if (init?.body != null && typeof init.body === "string") {
      try {
        body = JSON.parse(init.body)
      } catch {
        body = init.body
      }
    } else if (init?.body != null) {
      body = init.body
    }
    calls.push({ method, url, body })
  }
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    record(input, init)
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  })
  vi.stubGlobal("fetch", mock)
  return { calls, mock, record }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("server 地址配置", () => {
  it("normalizeApiBase 自动补全协议并去尾斜杠", () => {
    expect(normalizeApiBase("192.168.1.10:8000")).toBe("http://192.168.1.10:8000")
    expect(normalizeApiBase("https://example.com/")).toBe("https://example.com")
    expect(normalizeApiBase("")).toBe("")
  })

  it("setApiBase / getApiBase 读写 localStorage", () => {
    setApiBase("http://localhost:8000")
    expect(getApiBase()).toBe("http://localhost:8000")
  })
})

describe("checkServerHealth", () => {
  it("未配置地址时返回错误", async () => {
    const res = await checkServerHealth("")
    expect(res.ok).toBe(false)
  })

  it("探测 /health 端点", async () => {
    const { calls } = installFetchMock()
    const res = await checkServerHealth(`${BASE}/`)
    expect(calls[0].url).toBe(`${BASE}/health`)
    expect(calls[0].method).toBe("GET")
    expect(res.ok).toBe(true)
  })
})

describe("chatApi", () => {
  it("send 使用 POST /api/v1/chat", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)
    await chatApi.send({ content: "hi", stream: false })
    expect(calls[0]).toMatchObject({ method: "POST", url: `${BASE}/api/v1/chat` })
    expect(calls[0].body).toMatchObject({ content: "hi", stream: false })
  })

  it("sendStream 使用 POST /api/v1/chat 并传 stream:true", async () => {
    const { calls, mock, record } = installFetchMock()
    setApiBase(BASE)
    // 模拟 SSE 响应
    mock.mockImplementationOnce(async (input, init) => {
      record(input, init)
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: {"content":"你"}\n\n`))
          controller.enqueue(new TextEncoder().encode(`data: {"content":"好"}\n\n`))
          controller.close()
        },
      })
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    })
    const full = await chatApi.sendStream({ content: "hi" })
    expect(calls[0].url).toBe(`${BASE}/api/v1/chat`)
    expect((calls[0].body as Record<string, unknown>).stream).toBe(true)
    expect(full).toBe("你好")
  })

  it("getHistory 使用 GET /api/v1/chat/history", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)
    await chatApi.getHistory("s1")
    expect(calls[0]).toMatchObject({
      method: "GET",
      url: `${BASE}/api/v1/chat/history?session_id=s1`,
    })
  })

  it("getSessions 使用 GET /api/v1/chat/sessions", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)
    await chatApi.getSessions()
    expect(calls[0]).toMatchObject({ method: "GET", url: `${BASE}/api/v1/chat/sessions` })
  })

  it("deleteSession 使用 DELETE /api/v1/chat/sessions/{id}", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)
    await chatApi.deleteSession("s1")
    expect(calls[0]).toMatchObject({
      method: "DELETE",
      url: `${BASE}/api/v1/chat/sessions/s1`,
    })
  })
})

describe("kbApi", () => {
  it("listCollections", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)
    await kbApi.listCollections()
    expect(calls[0]).toMatchObject({ method: "GET", url: `${BASE}/api/v1/kb/collections` })
  })

  it("createCollection", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)
    await kbApi.createCollection({ name: "数学", zone: "study" })
    expect(calls[0]).toMatchObject({ method: "POST", url: `${BASE}/api/v1/kb/collections` })
    expect(calls[0].body).toMatchObject({ name: "数学", zone: "study" })
  })

  it("updateCollection", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)
    await kbApi.updateCollection("c1", { name: "高数" })
    expect(calls[0]).toMatchObject({
      method: "PATCH",
      url: `${BASE}/api/v1/kb/collections/c1`,
    })
  })

  it("upload 使用 FormData", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)
    const file = new File(["x"], "doc.md", { type: "text/markdown" })
    await kbApi.upload(file, "c1")
    expect(calls[0].url).toBe(`${BASE}/api/v1/kb/upload`)
    expect(calls[0].method).toBe("POST")
    expect(calls[0].body).toBeInstanceOf(FormData)
  })

  it("listDocuments 携带 page/limit/collection_id", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)
    await kbApi.listDocuments(2, 10, "c1")
    expect(calls[0].url).toContain(`${BASE}/api/v1/kb/documents?`)
    expect(calls[0].url).toContain("page=2")
    expect(calls[0].url).toContain("limit=10")
    expect(calls[0].url).toContain("collection_id=c1")
  })

  it("getDocumentStatus / deleteDocument / content / file / segments / pages / config", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)

    await kbApi.getDocumentStatus("batch1")
    await kbApi.deleteDocument("d1")
    await kbApi.getDocumentContent("d1")
    await kbApi.getDocumentSegments("d1")
    await kbApi.getDocumentPages("d1")
    await kbApi.getDocumentPage("d1", 3)
    await kbApi.getLearningPath("d1")
    await kbApi.generateLearningPath("d1")
    await kbApi.getConfig()

    const urls = calls.map((c) => `${c.method} ${c.url}`)
    expect(urls).toContain(`GET ${BASE}/api/v1/kb/documents/batch1/status`)
    expect(urls).toContain(`DELETE ${BASE}/api/v1/kb/documents/d1`)
    expect(urls).toContain(`GET ${BASE}/api/v1/kb/documents/d1/content`)
    expect(urls).toContain(`GET ${BASE}/api/v1/kb/documents/d1/segments`)
    expect(urls).toContain(`GET ${BASE}/api/v1/kb/documents/d1/pages`)
    expect(urls).toContain(`GET ${BASE}/api/v1/kb/documents/d1/pages/3`)
    expect(urls).toContain(`GET ${BASE}/api/v1/kb/documents/d1/learning-path`)
    expect(urls).toContain(`POST ${BASE}/api/v1/kb/documents/d1/learning-path`)
    expect(urls).toContain(`GET ${BASE}/api/v1/kb/config`)
  })

  it("getThumbnailUrl 指向 thumbnail 端点", () => {
    setApiBase(BASE)
    expect(getThumbnailUrl("d1")).toBe(`${BASE}/api/v1/kb/documents/d1/thumbnail`)
  })

  it("exportPackage 使用 GET /api/v1/kb/documents/{id}/export", async () => {
    const { calls, mock, record } = installFetchMock()
    setApiBase(BASE)
    mock.mockImplementationOnce(async (input, init) => {
      record(input, init)
      return new Response(new Blob(["zip"]), { status: 200 })
    })
    await kbApi.exportPackage("d1", "book")
    expect(calls[0]).toMatchObject({
      method: "GET",
      url: `${BASE}/api/v1/kb/documents/d1/export`,
    })
  })

  it("importPackage 使用 POST /api/v1/kb/import 并带 FormData", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)
    const file = new File(["zip"], "book.zip", { type: "application/zip" })
    await kbApi.importPackage(file, "c1")
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: `${BASE}/api/v1/kb/import`,
    })
    expect(calls[0].body).toBeInstanceOf(FormData)
  })
})

describe("questionsApi", () => {
  it("generateFromPages 使用 POST /api/v1/questions/generate-from-pages", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)
    await questionsApi.generateFromPages({ document_id: "d1", page_numbers: [1, 2] })
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: `${BASE}/api/v1/questions/generate-from-pages`,
    })
    expect(calls[0].body).toMatchObject({ document_id: "d1", page_numbers: [1, 2] })
  })

  it("list 携带 document_id / keyword", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)
    await questionsApi.list({ document_id: "d1" })
    expect(calls[0].url).toContain(`${BASE}/api/v1/questions?document_id=d1`)
    await questionsApi.list({ document_id: "d1", keyword: "极限" })
    expect(calls[1].url).toContain(`${BASE}/api/v1/questions?document_id=d1&keyword=%E6%9E%81%E9%99%90`)
  })

  it("generateWholeDocument 使用 POST /api/v1/questions/generate-whole-document", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)
    await questionsApi.generateWholeDocument({ document_id: "d1", questions_per_page: 2 })
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: `${BASE}/api/v1/questions/generate-whole-document`,
    })
    expect(calls[0].body).toMatchObject({ document_id: "d1", questions_per_page: 2 })
  })

  it("get 使用 GET /api/v1/questions/{id}", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)
    await questionsApi.get("q1")
    expect(calls[0]).toMatchObject({ method: "GET", url: `${BASE}/api/v1/questions/q1` })
  })

  it("deleteByDocument 使用 DELETE /api/v1/questions", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)
    await questionsApi.deleteByDocument("d1")
    expect(calls[0].method).toBe("DELETE")
    expect(calls[0].url).toContain(`${BASE}/api/v1/questions?`)
    expect(calls[0].url).toContain("document_id=d1")
  })

  it("deleteBulk 使用 DELETE /api/v1/questions/bulk", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)
    await questionsApi.deleteBulk({ document_id: "d1" })
    expect(calls[0]).toMatchObject({
      method: "DELETE",
      url: `${BASE}/api/v1/questions/bulk`,
    })
  })
})

describe("quizApi", () => {
  it("createSession / getSession / submitAnswer / getResults / recent", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)

    await quizApi.createSession({ question_ids: ["q1"] })
    await quizApi.getSession("s1")
    await quizApi.getRecentActiveSession("d1")
    await quizApi.submitAnswer("s1", { question_id: "q1", user_answer: "B" })
    await quizApi.grade({ question_id: "q1", user_answer: "B" })
    await quizApi.getResults("s1")

    const urls = calls.map((c) => `${c.method} ${c.url}`)
    expect(urls).toContain(`POST ${BASE}/api/v1/quiz/sessions`)
    expect(urls).toContain(`GET ${BASE}/api/v1/quiz/sessions/s1`)
    expect(urls).toContain(`GET ${BASE}/api/v1/quiz/sessions/recent/by-document/d1`)
    expect(urls).toContain(`POST ${BASE}/api/v1/quiz/sessions/s1/answers`)
    expect(urls).toContain(`POST ${BASE}/api/v1/quiz/grade`)
    expect(urls).toContain(`GET ${BASE}/api/v1/quiz/sessions/s1/results`)
  })
})

describe("tutorApi", () => {
  it("createSession / getSession / sendMessage", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)

    await tutorApi.createSession({ question_id: "q1" })
    await tutorApi.getSession("s1")
    await tutorApi.sendMessage("s1", "为什么？", false)

    const urls = calls.map((c) => `${c.method} ${c.url}`)
    expect(urls).toContain(`POST ${BASE}/api/v1/tutor/sessions`)
    expect(urls).toContain(`GET ${BASE}/api/v1/tutor/sessions/s1`)
    expect(urls).toContain(`POST ${BASE}/api/v1/tutor/sessions/s1/messages`)
  })
})

describe("dashboardApi / analyticsApi / reportsApi", () => {
  it("dashboard.suggestions", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)
    await dashboardApi.getSuggestions()
    expect(calls[0]).toMatchObject({
      method: "GET",
      url: `${BASE}/api/v1/dashboard/suggestions`,
    })
  })

  it("analytics 各端点", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)

    await analyticsApi.getStats()
    await analyticsApi.getTagStats("d1")
    await analyticsApi.generateLearningReport()
    await analyticsApi.getActivity()
    await analyticsApi.reportActivity(30)

    const urls = calls.map((c) => `${c.method} ${c.url}`)
    expect(urls).toContain(`GET ${BASE}/api/v1/analytics/stats`)
    expect(urls).toContain(`GET ${BASE}/api/v1/analytics/tag-stats?document_id=d1`)
    expect(urls).toContain(`POST ${BASE}/api/v1/analytics/learning-report`)
    expect(urls).toContain(`GET ${BASE}/api/v1/analytics/activity`)
    expect(urls).toContain(`POST ${BASE}/api/v1/analytics/activity`)
    expect(calls[calls.length - 1].body).toEqual({ seconds: 30 })
  })

  it("reports 各端点", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)

    await reportsApi.generate()
    await reportsApi.list()
    await reportsApi.getLatest()
    await reportsApi.get("r1")

    const urls = calls.map((c) => `${c.method} ${c.url}`)
    expect(urls).toContain(`POST ${BASE}/api/v1/reports/generate`)
    expect(urls).toContain(`GET ${BASE}/api/v1/reports`)
    expect(urls).toContain(`GET ${BASE}/api/v1/reports/latest`)
    expect(urls).toContain(`GET ${BASE}/api/v1/reports/r1`)
  })
})

describe("trainingApi", () => {
  it("targeted 各端点", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)

    await trainingApi.startTargeted({ report_id: "r1" })
    await trainingApi.getActiveSession("r1")
    await trainingApi.resumeSession("s1")
    await trainingApi.sendTutorMessage("agent1", "继续", false)

    const urls = calls.map((c) => `${c.method} ${c.url}`)
    expect(urls).toContain(`POST ${BASE}/api/v1/training/targeted/start`)
    expect(urls).toContain(
      `GET ${BASE}/api/v1/training/targeted/reports/r1/active-session`
    )
    expect(urls).toContain(`GET ${BASE}/api/v1/training/targeted/sessions/s1`)
    expect(urls).toContain(`POST ${BASE}/api/v1/training/targeted/tutor/agent1`)
  })
})

describe("companionApi", () => {
  it("sendStream 使用 POST /api/v1/companion/chat 并带页码上下文", async () => {
    const { calls, mock, record } = installFetchMock()
    setApiBase(BASE)
    mock.mockImplementationOnce(async (input, init) => {
      record(input, init)
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: {"content":"好"}\n\n`))
          controller.close()
        },
      })
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    })
    await companionApi.sendStream({
      document_id: "d1",
      content: "这页讲了什么",
      page_number: 3,
      page_content: "导数的定义",
    })
    expect(calls[0].url).toBe(`${BASE}/api/v1/companion/chat`)
    expect(calls[0].body).toMatchObject({
      document_id: "d1",
      content: "这页讲了什么",
      page_number: 3,
      page_content: "导数的定义",
    })
  })

  it("getHistory 使用 GET /api/v1/companion/sessions/{id}", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)
    await companionApi.getHistory("d1")
    expect(calls[0]).toMatchObject({
      method: "GET",
      url: `${BASE}/api/v1/companion/sessions/d1`,
    })
  })
})

describe("notesApi", () => {
  it("saveTip 使用 POST /api/v1/notes/tips", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)
    await notesApi.saveTip({
      document_id: "d1",
      page_number: 3,
      title: "重点",
      content: "极限的定义",
      tags: ["易错"],
    })
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: `${BASE}/api/v1/notes/tips`,
    })
    expect(calls[0].body).toMatchObject({
      document_id: "d1",
      page_number: 3,
      title: "重点",
      content: "极限的定义",
      tags: ["易错"],
    })
  })

  it("list 携带 document_id / note_type / limit", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)
    await notesApi.list({ document_id: "d1", note_type: "tip", limit: 50 })
    expect(calls[0].url).toContain(`${BASE}/api/v1/notes?`)
    expect(calls[0].url).toContain("document_id=d1")
    expect(calls[0].url).toContain("note_type=tip")
    expect(calls[0].url).toContain("limit=50")
  })

  it("listTips 使用 GET /api/v1/notes/tips/{id}", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)
    await notesApi.listTips("d1")
    expect(calls[0]).toMatchObject({
      method: "GET",
      url: `${BASE}/api/v1/notes/tips/d1`,
    })
  })

  it("get 使用 GET /api/v1/notes/{id}", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)
    await notesApi.get("n1")
    expect(calls[0]).toMatchObject({
      method: "GET",
      url: `${BASE}/api/v1/notes/n1`,
    })
  })

  it("listTipTags 使用 GET /api/v1/notes/tip-tags", async () => {
    const { calls } = installFetchMock()
    setApiBase(BASE)
    await notesApi.listTipTags()
    expect(calls[0]).toMatchObject({
      method: "GET",
      url: `${BASE}/api/v1/notes/tip-tags`,
    })
  })
})
