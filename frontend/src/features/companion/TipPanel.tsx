import { useEffect, useState } from "react"
import { FileText, Loader2, X } from "lucide-react"
import { notesApi, type NoteItem } from "@/lib/api"
import { cn } from "@/lib/utils"

interface TipPanelProps {
  docId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 点击 tip 时跳转到对应页 */
  onJumpToPage?: (page: number) => void
}

export function TipPanel({ docId, open, onOpenChange, onJumpToPage }: TipPanelProps) {
  const [tips, setTips] = useState<NoteItem[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const res = await notesApi.listTips(docId)
        if (!cancelled) setTips(res.notes || [])
      } catch {
        if (!cancelled) setTips([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [docId, open])

  const parsePage = (note: NoteItem): number | null => {
    const m = /第\s*(\d+)\s*页/.exec(note.title || "")
    return m ? Number(m[1]) : null
  }

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-ink/10" onClick={() => onOpenChange(false)} aria-hidden="true" />
      )}

      <aside
        className={cn(
          "fixed top-0 right-0 bottom-0 z-40 bg-paper border-l border-line shadow-lg flex flex-col transition-transform duration-300",
          open ? "translate-x-0" : "translate-x-full"
        )}
        style={{ width: "min(340px, 90vw)" }}
        role="dialog"
        aria-label="本书笔记"
      >
        <div className="flex items-center gap-2 px-3 h-12 border-b border-line shrink-0">
          <FileText className="w-5 h-5 text-sea shrink-0" strokeWidth={2} />
          <div className="min-w-0 flex-1">
            <div className="text-small font-semibold text-ink leading-tight">本书笔记</div>
            <div className="text-caption text-ink-disabled leading-tight">共 {tips.length} 条</div>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="w-8 h-8 rounded-md flex items-center justify-center text-ink-disabled hover:text-ink hover:bg-paper-2 transition-colors shrink-0"
            aria-label="关闭笔记"
          >
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scroll-thin p-3 space-y-2.5">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-caption text-ink-disabled gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> 加载笔记…
            </div>
          ) : tips.length === 0 ? (
            <div className="text-caption text-ink-disabled text-center py-10 leading-relaxed">
              还没有笔记。
              <br />
              划选文字或让 AI 回答后「tip 到笔记」，
              <br />
              会保存到这里并同步到笔记页。
            </div>
          ) : (
            tips.map((tip) => {
              const page = parsePage(tip)
              return (
                <button
                  key={tip.id}
                  type="button"
                  onClick={() => page != null && onJumpToPage?.(page)}
                  className={cn(
                    "w-full text-left rounded-lg border border-line-light bg-paper-2 px-3 py-2.5 space-y-1.5 transition-colors",
                    page != null ? "hover:border-sea/40 hover:bg-paper" : "cursor-default"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-caption font-medium text-sea shrink-0">
                      第 {page ?? "—"} 页
                    </span>
                    <span className="text-small font-medium text-ink truncate flex-1">{tip.title}</span>
                  </div>
                  <p className="text-caption text-ink-soft leading-relaxed line-clamp-4 whitespace-pre-wrap">
                    {tip.content_md}
                  </p>
                </button>
              )
            })
          )}
        </div>
      </aside>
    </>
  )
}
