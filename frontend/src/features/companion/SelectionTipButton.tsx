import { useEffect, useState } from "react"
import { StickyNote } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface SelectionTipButtonProps {
  containerRef: React.RefObject<HTMLElement | null>
  /** 仅 md/txt 内容可划选；PDF（canvas）为 false */
  enabled: boolean
  docName: string
  pageNumber: number | null
  onSave: (content: string, title: string) => void
}

const MAX_SELECT_LEN = 5000

export function SelectionTipButton({
  containerRef,
  enabled,
  docName,
  pageNumber,
  onSave,
}: SelectionTipButtonProps) {
  const [anchor, setAnchor] = useState<{ text: string; x: number; y: number } | null>(null)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")

  useEffect(() => {
    if (!enabled) return
    const refresh = () => {
      const container = containerRef.current
      const sel = window.getSelection()
      const text = sel?.toString().trim() ?? ""
      if (!container || !text || text.length > MAX_SELECT_LEN || !sel || sel.isCollapsed) {
        setAnchor(null)
        return
      }
      if (!container.contains(sel.anchorNode) || !container.contains(sel.focusNode)) {
        setAnchor(null)
        return
      }
      const range = sel.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        setAnchor(null)
        return
      }
      const x = clamp(rect.left + rect.width / 2, 80, window.innerWidth - 80)
      const y = clamp(rect.bottom + 8, 8, window.innerHeight - 72)
      setAnchor({ text, x, y })
    }
    document.addEventListener("selectionchange", refresh)
    document.addEventListener("pointerup", refresh)
    return () => {
      document.removeEventListener("selectionchange", refresh)
      document.removeEventListener("pointerup", refresh)
    }
  }, [enabled, containerRef])

  const handleSave = () => {
    if (!content.trim()) return
    onSave(content.trim(), title.trim() || `第 ${pageNumber ?? "—"} 页摘录`)
    setOpen(false)
    setTitle("")
    setContent("")
    setAnchor(null)
    window.getSelection()?.removeAllRanges()
  }

  return (
    <>
      {enabled && anchor && (
        <button
          type="button"
          onClick={() => {
            setContent(anchor.text)
            setTitle(`第 ${pageNumber ?? "—"} 页摘录`)
            setOpen(true)
          }}
          className="fixed z-40 inline-flex items-center gap-1.5 h-10 px-3 rounded-full bg-ink text-paper text-small font-medium
                     shadow-md hover:bg-sea transition-colors"
          style={{ left: anchor.x - 56, top: anchor.y }}
        >
          <StickyNote className="w-4 h-4" strokeWidth={2} />
          tip 到笔记
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>tip 到笔记</DialogTitle>
            <DialogDescription>
              将自动归档到《{docName}》第 {pageNumber ?? "—"} 页的笔记（预览为本地保存）
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <label className="block text-caption text-ink-soft mb-1">标题</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={`第 ${pageNumber ?? "—"} 页摘录`}
                className="w-full h-10 px-3 rounded-lg border border-line bg-paper-2 text-body text-ink
                           placeholder:text-ink-disabled focus:outline-none focus:border-sea focus:ring-1 focus:ring-sea-subtle"
              />
            </div>
            <div>
              <label className="block text-caption text-ink-soft mb-1">内容</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={5}
                className="w-full rounded-lg border border-line bg-paper-2 px-3 py-2 text-body text-ink leading-relaxed
                           focus:outline-none focus:border-sea focus:ring-1 focus:ring-sea-subtle"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={!content.trim()}>
              保存到笔记
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}
