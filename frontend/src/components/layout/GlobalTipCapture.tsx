import { useEffect, useMemo, useState } from "react"
import { useLocation } from "react-router-dom"
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
import { kbApi, notesApi } from "@/lib/api"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

const MIN_LEN = 2
const IGNORE = "input, textarea, select, [contenteditable='true'], #app-sidebar, [data-no-tip]"

function inferDocId(pathname: string, search: string): string | null {
  const m =
    pathname.match(/\/(?:companion|quiz|knowledge)\/doc\/([^/?#]+)/) ||
    pathname.match(/\/question-gen\/doc\/([^/?#]+)/)
  if (m) return decodeURIComponent(m[1])
  const q = new URLSearchParams(search).get("document_id")
  return q || null
}

function closestAttr(node: Node | null, selector: string, attr: string): string | null {
  const el = node instanceof Element ? node : node?.parentElement
  return el?.closest(selector)?.getAttribute(attr) ?? null
}

export function GlobalTipCapture() {
  const location = useLocation()
  const [anchor, setAnchor] = useState<{ text: string; x: number; y: number } | null>(null)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [saving, setSaving] = useState(false)
  const [docId, setDocId] = useState("")
  const [pageNumber, setPageNumber] = useState<number | null>(null)
  const [docs, setDocs] = useState<Array<{ id: string; name: string }>>([])
  const [knownTags, setKnownTags] = useState<string[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState("")

  useEffect(() => {
    const hide = () => {
      if (!open) setAnchor(null)
    }

    const maybeShow = () => {
      if (open) return
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        hide()
        return
      }
      const node = sel.anchorNode
      const el = node instanceof Element ? node : node?.parentElement
      if (el?.closest(IGNORE)) {
        hide()
        return
      }
      const text = sel.toString().replace(/\s+/g, " ").trim()
      if (text.length < MIN_LEN) {
        hide()
        return
      }
      const range = sel.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        hide()
        return
      }
      const pageRaw = closestAttr(node, "[data-page]", "data-page")
      const fromDom = closestAttr(node, "[data-tip-doc]", "data-tip-doc")
      setPageNumber(pageRaw && Number.isFinite(Number(pageRaw)) ? Number(pageRaw) : null)
      setDocId(fromDom || inferDocId(location.pathname, location.search) || "")
      setAnchor({
        text,
        x: Math.min(Math.max(rect.left + rect.width / 2, 80), window.innerWidth - 80),
        y: Math.min(Math.max(rect.bottom + 8, 8), window.innerHeight - 56),
      })
    }

    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest("[data-tip-fab], [data-tip-dialog]")) return
      window.setTimeout(() => {
        if (!window.getSelection()?.toString().trim()) hide()
      }, 0)
    }

    document.addEventListener("mouseup", maybeShow)
    document.addEventListener("keyup", maybeShow)
    document.addEventListener("mousedown", onMouseDown)
    document.addEventListener("scroll", hide, true)
    return () => {
      document.removeEventListener("mouseup", maybeShow)
      document.removeEventListener("keyup", maybeShow)
      document.removeEventListener("mousedown", onMouseDown)
      document.removeEventListener("scroll", hide, true)
    }
  }, [open, location.pathname, location.search])

  useEffect(() => {
    if (!open) return
    kbApi
      .listDocuments(1, 100)
      .then((res) => {
        const raw = res?.documents || res?.data || []
        setDocs(
          (Array.isArray(raw) ? raw : []).map((d: { id?: string; name?: string; display_name?: string }) => ({
            id: String(d.id || ""),
            name: String(d.name || d.display_name || "未命名资料"),
          })).filter((d: { id: string }) => d.id),
        )
      })
      .catch(() => setDocs([]))
    notesApi
      .listTipTags()
      .then((res) => setKnownTags(res.tags || []))
      .catch(() => setKnownTags([]))
  }, [open])

  const chipTags = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const t of [...selectedTags, ...knownTags]) {
      const name = t.trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      out.push(name)
    }
    return out
  }, [knownTags, selectedTags])

  const addDraftTag = () => {
    const name = tagDraft.trim().replace(/^[#＃]/, "")
    if (!name) return
    setSelectedTags((prev) => (prev.includes(name) ? prev : [...prev, name]))
    setTagDraft("")
  }

  const handleSave = async () => {
    const body = content.trim()
    if (!body || saving) return
    setSaving(true)
    try {
      await notesApi.saveTip({
        document_id: docId || null,
        page_number: pageNumber,
        title: title.trim() || (pageNumber != null ? `第 ${pageNumber} 页摘录` : body.slice(0, 24)),
        content: body,
        tags: selectedTags,
      })
      toast.success("已收入 tip")
      setOpen(false)
      setAnchor(null)
      setTitle("")
      setContent("")
      setSelectedTags([])
      setTagDraft("")
      window.getSelection()?.removeAllRanges()
    } catch {
      toast.error("保存 tip 失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {anchor && !open && (
        <button
          type="button"
          data-tip-fab
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setContent(anchor.text)
            setTitle(pageNumber != null ? `第 ${pageNumber} 页摘录` : `tip · ${anchor.text.slice(0, 16)}`)
            setOpen(true)
          }}
          className="fixed z-[70] inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-ink text-paper text-caption font-medium shadow-[0_8px_24px_rgba(20,33,43,0.18)] hover:bg-sea transition-colors"
          style={{ left: anchor.x, top: anchor.y, transform: "translateX(-50%)" }}
        >
          <StickyNote className="w-3.5 h-3.5" strokeWidth={2} />
          tip
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" data-tip-dialog>
          <DialogHeader>
            <DialogTitle>收入 tip</DialogTitle>
            <DialogDescription>
              划选的内容会进笔记页的 tip 堆叠。tag 是你自己用来分类的，不是知识点。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="block text-caption text-ink-soft mb-1">划选内容</label>
              <div className="rounded-r-xl border-l-[3px] border-sea bg-sea-subtle/70 px-3 py-2 text-small text-ink leading-relaxed max-h-24 overflow-y-auto whitespace-pre-wrap">
                {content}
              </div>
            </div>
            <div>
              <label className="block text-caption text-ink-soft mb-1">标题</label>
              <input
                type="text"
                value={title}
                maxLength={40}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-line bg-paper text-body text-ink focus:outline-none focus:border-sea"
              />
            </div>
            <div>
              <label className="block text-caption text-ink-soft mb-1">关联资料</label>
              <select
                value={docId}
                onChange={(e) => setDocId(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-line bg-paper text-body text-ink focus:outline-none focus:border-sea"
              >
                <option value="">不关联资料</option>
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              {pageNumber != null ? (
                <p className="text-[11px] text-ink-disabled mt-1">当前页：第 {pageNumber} 页</p>
              ) : null}
            </div>
            <div>
              <label className="block text-caption text-ink-soft mb-1">Tag</label>
              {chipTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {chipTags.map((tag) => {
                    const on = selectedTags.includes(tag)
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() =>
                          setSelectedTags((prev) =>
                            on ? prev.filter((t) => t !== tag) : [...prev, tag],
                          )
                        }
                        className={cn(
                          "h-7 px-2.5 rounded-full border text-[11px] font-medium transition-colors",
                          on
                            ? "bg-sea text-paper border-sea"
                            : "bg-paper border-line text-ink-soft hover:border-sea/40 hover:text-sea",
                        )}
                      >
                        {tag}
                      </button>
                    )
                  })}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      addDraftTag()
                    }
                  }}
                  placeholder="输入新 tag，回车加上"
                  className="flex-1 h-10 px-3 rounded-xl border border-line bg-paper text-body text-ink placeholder:text-ink-disabled focus:outline-none focus:border-sea"
                />
                <Button type="button" variant="outline" onClick={addDraftTag} disabled={!tagDraft.trim()}>
                  加上
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void handleSave()} disabled={!content.trim() || saving}>
              {saving ? "保存中…" : "收入 tip"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
