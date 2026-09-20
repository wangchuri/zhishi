import { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { Loader2, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { AppShell } from "@/components/layout/AppShell"
import { Button } from "@/components/ui/button"
import { MarkdownWithMath } from "@/components/blocks/MarkdownWithMath"
import { NoteContent } from "@/features/notes/NoteContent"
import { notesApi, documentImageBase, type NoteItem } from "@/lib/api"

function formatMeta(note: NoteItem): string {
  const parts: string[] = []
  if (note.created_at) {
    try {
      parts.push(
        new Date(note.created_at).toLocaleString("zh-CN", {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      )
    } catch {
      /* ignore */
    }
  }
  const words = (note.content_md || "").length
  if (words) parts.push(`${words} 字`)
  if (note.note_type === "report") parts.push("学习报告")
  if (note.note_type === "tip") parts.push("tip")
  if (note.note_type === "manual" && note.folder) parts.push(note.folder)
  if (note.document_name) parts.push(`《${note.document_name}》`)
  if (note.page_number != null) parts.push(`第 ${note.page_number} 页`)
  return parts.join(" · ") || "—"
}

export function NoteDetailPage() {
  const { noteId } = useParams()
  const navigate = useNavigate()
  const [note, setNote] = useState<NoteItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleDelete = async () => {
    if (!note) return
    try {
      await notesApi.remove(note.id)
      toast.success("已删除笔记")
      navigate("/notes")
    } catch {
      toast.error("删除失败")
      setConfirmDelete(false)
    }
  }

  useEffect(() => {
    if (!noteId) return
    let cancelled = false
    notesApi
      .get(noteId)
      .then((item) => {
        if (!cancelled) setNote(item)
      })
      .catch(() => {
        if (!cancelled) setMissing(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [noteId])

  const isTip = note?.note_type === "tip"
  const isManual = note?.note_type === "manual"
  const backTo = isTip ? "/notes#tips" : "/notes#notes"

  return (
    <AppShell maxWidth={760}>
      <button
        type="button"
        onClick={() => navigate(backTo)}
        className="text-small text-ink-soft hover:text-sea mb-6"
      >
        ← 返回{isTip ? " tip" : "笔记"}
      </button>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-ink-disabled gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          打开笔记…
        </div>
      ) : missing || !note ? (
        <div className="rounded-2xl border border-line bg-paper p-8 text-center text-ink-soft">
          找不到这条笔记。
          <div className="mt-3">
            <Link to="/notes" className="text-sea hover:underline">
              回笔记页
            </Link>
          </div>
        </div>
      ) : (
        <article className="rounded-2xl border border-line bg-paper p-6 md:p-8 shadow-[0_4px_20px_-2px_rgba(20,33,43,0.05)]">
          <div className="flex items-start justify-between gap-3 mb-3">
            <h1 className="font-display text-[1.6rem] leading-snug text-ink">{note.title || "无标题"}</h1>
            {isManual ? (
              <div className="flex items-center gap-2 shrink-0">
                {confirmDelete ? (
                  <>
                    <Button variant="danger" size="sm" onClick={() => void handleDelete()}>
                      确认删除
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                      取消
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => navigate(`/notes/${note.id}/edit`)}
                    >
                      <Pencil className="w-4 h-4" strokeWidth={2} />
                      编辑
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                      <Trash2 className="w-4 h-4" strokeWidth={2} />
                      删除
                    </Button>
                  </>
                )}
              </div>
            ) : note.note_type === "report" ? (
              <span className="inline-flex items-center h-6 px-2 rounded-full bg-sea-subtle text-sea text-[11px] font-medium shrink-0">
                学习报告
              </span>
            ) : isTip ? (
              <span className="inline-flex items-center h-6 px-2 rounded-full bg-sea-subtle text-sea text-[11px] font-medium shrink-0">
                tip
              </span>
            ) : null}
          </div>
          <p className="text-caption text-ink-disabled mb-4">{formatMeta(note)}</p>
          {isTip && (note.tags || []).length > 0 ? (
            <div className="flex flex-wrap gap-1.5 mb-6">
              {(note.tags || []).map((tag) => (
                <span key={tag} className="h-6 px-2.5 rounded-full bg-sea-subtle text-sea text-[11px] leading-6">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
          {isTip ? (
            <div className="my-2 mb-5 px-4 py-3 border-l-[3px] border-sea bg-sea-subtle/60 rounded-r-xl [&_img]:max-h-64 [&_img]:rounded-md">
              <MarkdownWithMath
                proseClass="prose prose-sm max-w-none text-ink leading-relaxed"
                imageBaseUrl={note.document_id ? documentImageBase(note.document_id) : undefined}
              >
                {note.content_md || ""}
              </MarkdownWithMath>
            </div>
          ) : (
            <NoteContent content={note.content_md || ""} />
          )}
          {isTip && note.document_id ? (
            <p className="text-caption text-ink-disabled mt-6">
              来自资料阅读。
              <Link
                to={`/companion/doc/${note.document_id}${note.page_number ? `?page=${note.page_number}` : ""}`}
                className="ml-2 text-sea hover:underline"
              >
                打开原页
              </Link>
            </p>
          ) : null}
        </article>
      )}
    </AppShell>
  )
}
