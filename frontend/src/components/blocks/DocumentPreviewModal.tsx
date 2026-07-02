import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import { Loader2, X } from "lucide-react"
import { kbApi } from "@/lib/api"
import type { Citation } from "@/types"

interface DocumentPreviewModalProps {
  docId: string
  title?: string | null
  charStart?: number | null
  charEnd?: number | null
  onClose: () => void
}

export function DocumentPreviewModal({
  docId,
  title,
  charStart,
  charEnd,
  onClose,
}: DocumentPreviewModalProps) {
  const [fileName, setFileName] = useState(title || "文档预览")
  const [content, setContent] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    kbApi
      .getDocumentContent(docId)
      .then((res) => {
        setFileName(res.file_name || title || "文档预览")
        setContent(res.content || "")
      })
      .catch((err: Error) => setError(err.message || "加载失败"))
      .finally(() => setLoading(false))
  }, [docId, title])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-surface rounded-xl border border-line-soft shadow-lg w-full max-w-[720px] max-h-[85vh] flex flex-col mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-line-soft">
          <div className="flex-1 min-w-0">
            <div className="text-card-title font-semibold text-ink-primary truncate">{fileName}</div>
            {(charStart != null && charEnd != null) && (
              <div className="text-caption text-ink-tertiary mt-0.5">
                高亮位置 {charStart}–{charEnd}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-md flex items-center justify-center text-ink-tertiary hover:text-ink-primary hover:bg-surface-soft transition-colors shrink-0"
          >
            <X className="w-5 h-5" strokeWidth={2} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto scroll-thin p-5">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="flex items-center gap-2 text-ink-tertiary">
                <Loader2 className="w-5 h-5 animate-spin" strokeWidth={2} />
                <span className="text-body">加载中...</span>
              </div>
            </div>
          ) : error ? (
            <div className="text-body text-danger">{error}</div>
          ) : (
            <pre className="text-body text-ink-primary whitespace-pre-wrap font-sans leading-relaxed">
              {renderHighlightedContent(content, charStart, charEnd)}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

/** 从 citation 打开预览 */
export function CitationPreviewButton({
  citation,
  className,
  label,
}: {
  citation: Citation
  className?: string
  label?: string
}) {
  const [open, setOpen] = useState(false)
  if (!citation.doc_id) return null

  const displayLabel =
    label ?? `📄 ${citation.title || citation.snippet?.slice(0, 40) || "查看原文"}`

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className ?? "text-left text-small text-primary hover:underline"}
      >
        {displayLabel}
      </button>
      {open && (
        <DocumentPreviewModal
          docId={citation.doc_id}
          title={citation.title}
          charStart={citation.char_start}
          charEnd={citation.char_end}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function renderHighlightedContent(
  content: string,
  start?: number | null,
  end?: number | null
): ReactNode {
  if (
    start == null ||
    end == null ||
    start < 0 ||
    end <= start ||
    start >= content.length
  ) {
    return content
  }
  const safeEnd = Math.min(end, content.length)
  return (
    <>
      {content.slice(0, start)}
      <mark className="bg-warning-soft text-ink-primary rounded-sm px-0.5">
        {content.slice(start, safeEnd)}
      </mark>
      {content.slice(safeEnd)}
    </>
  )
}
