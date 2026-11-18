import type { QuizSessionSummary } from "@/types"

/** 会话名：优先自定义标题，其次文档名 */
export function sessionTitle(session: QuizSessionSummary): string {
  return session.title || session.document_name || "刷题会话"
}

function formatWhen(value?: string | null): string {
  if (!value) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`
  const sameYear = d.getFullYear() === now.getFullYear()
  const md = `${d.getMonth() + 1} 月 ${d.getDate()} 日`
  return sameYear ? `${md} ${hm}` : `${d.getFullYear()} 年 ${md}`
}

/** 会话副标题：文档名 · 进度 · 时间 */
export function sessionMeta(session: QuizSessionSummary): string {
  const parts: string[] = []
  if (session.title && session.document_name) parts.push(session.document_name)
  parts.push(`已答 ${session.answered_count || 0}/${session.total_questions || 0} 题`)
  const when = session.status === "completed" ? session.finished_at : session.started_at
  if (when) parts.push(formatWhen(when))
  return parts.join(" · ")
}
