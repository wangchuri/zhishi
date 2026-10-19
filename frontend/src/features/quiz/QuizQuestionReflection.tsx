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

/** 单条感想：详情页会把它按时间穿插到「那一次作答」后面 */
export function ReflectionItem({ note, compact }: { note: QuestionNote; compact?: boolean }) {
  return (
    <div
      className={
        compact
          ? "rounded-md border border-primary/15 bg-primary-soft/20 px-2.5 py-1.5 ml-4"
          : "rounded-md bg-surface/70 border border-line-soft px-3 py-2"
      }
    >
      <div className="flex items-center gap-1.5 text-caption text-ink-tertiary mb-0.5">
        <Sparkles className="w-3 h-3 text-primary shrink-0" />
        <span>{fmt(note.created_at)}</span>
        {compact ? <span className="text-ink-disabled">· 感想</span> : null}
      </div>
      <div className="text-small text-ink-primary whitespace-pre-wrap break-words">
        {note.content_md}
      </div>
    </div>
  )
}

/** 写感想：只追加、旧条不可改 */
export function ReflectionComposer({
  questionId,
  documentId,
  onCreated,
}: {
  questionId: string
  documentId?: string | null
  onCreated?: (note: QuestionNote) => void
}) {
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const append = async () => {
    const text = draft.trim()
    if (!text || saving) return
    setSaving(true)
    setError("")
    try {
      const created = await quizApi.addQuestionNote(questionId, text, documentId || undefined)
      setDraft("")
      onCreated?.(created)
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="写写这题的感想 / 思路（答对答错都行）…"
        rows={3}
        className="w-full rounded-md border border-line bg-paper px-3 py-2 text-body text-ink placeholder:text-ink-disabled focus:border-sea focus:ring-1 focus:ring-sea-subtle outline-none transition-all resize-y"
      />
      {error && <p className="text-caption text-danger mt-1">{error}</p>}
      <div className="flex justify-end mt-2">
        <Button variant="secondary" size="sm" onClick={() => void append()} disabled={saving || !draft.trim()}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          追加感想
        </Button>
      </div>
    </div>
  )
}

/**
 * 整块「我的感想」：列表 + 输入框。答题反馈里用这个；
 * 题目详情页则用 ReflectionItem / ReflectionComposer 自己按时间穿插。
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

  useEffect(() => {
    let cancelled = false
    setLoading(true)
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

  return (
    <div className="rounded-md border border-primary/20 bg-primary-soft/25 px-3 py-3">
      <div className="flex items-center gap-2 text-caption font-medium text-ink-tertiary mb-2">
        <Sparkles className="w-3.5 h-3.5 text-primary" />
        我的感想 · 只增不改
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-caption text-ink-tertiary py-1">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          加载中…
        </div>
      ) : notes.length > 0 ? (
        <ol className="space-y-2 mb-3">
          {notes.map((n) => (
            <li key={n.id}>
              <ReflectionItem note={n} />
            </li>
          ))}
        </ol>
      ) : null}

      <ReflectionComposer
        questionId={questionId}
        documentId={documentId}
        onCreated={(note) => setNotes((prev) => [...prev, note])}
      />
    </div>
  )
}
