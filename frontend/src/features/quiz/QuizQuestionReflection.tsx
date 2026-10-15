import { useEffect, useState } from "react"
import { Loader2, Plus, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { quizApi } from "@/lib/api"
import type { QuestionNote } from "@/types"

function fmt(iso?: string | null): string {
  if (!iso) return ""
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return ""
  }
}

/**
 * 每题「思路/灵感」：只追加、旧条不可改，按时间排序；答题后显示。
 * 内容同时归入笔记页的「题目思路」文件夹。
 */
export function QuizQuestionReflection({
  questionId,
  documentId,
}: {
  questionId: string
  documentId?: string | null
}) {
  const [notes, setNotes] = useState<QuestionNote[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setDraft("")
    setError("")
    quizApi
      .listQuestionNotes(questionId)
      .then((res) => {
        if (!cancelled) setNotes(res.notes || [])
      })
      .catch(() => {
        if (!cancelled) setNotes([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [questionId])

  const append = async () => {
    const text = draft.trim()
    if (!text || saving) return
    setSaving(true)
    setError("")
    try {
      const created = await quizApi.addQuestionNote(questionId, text, documentId || undefined)
      setNotes((prev) => [...prev, created])
      setDraft("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-md border border-primary/20 bg-primary-soft/25 px-3 py-3">
      <div className="flex items-center gap-2 text-caption font-medium text-ink-tertiary mb-2">
        <Sparkles className="w-3.5 h-3.5 text-primary" />
        我的思路 · 只增不改
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-caption text-ink-tertiary py-1">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          加载中…
        </div>
      ) : notes.length > 0 ? (
        <ol className="space-y-2 mb-3">
          {notes.map((n) => (
            <li key={n.id} className="rounded-md bg-surface/70 border border-line-soft px-3 py-2">
              <div className="text-caption text-ink-tertiary mb-0.5">{fmt(n.created_at)}</div>
              <div className="text-body text-ink-primary whitespace-pre-wrap break-words">
                {n.content_md}
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="写写这题的思路 / 灵感（答对答错都行）…"
        rows={3}
        className="w-full rounded-md border border-line bg-paper px-3 py-2 text-body text-ink placeholder:text-ink-disabled focus:border-sea focus:ring-1 focus:ring-sea-subtle outline-none transition-all resize-y"
      />
      {error && <p className="text-caption text-danger mt-1">{error}</p>}
      <div className="flex justify-end mt-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void append()}
          disabled={saving || !draft.trim()}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          追加思路
        </Button>
      </div>
    </div>
  )
}
