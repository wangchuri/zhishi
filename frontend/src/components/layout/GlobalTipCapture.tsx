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
import {
  documentImageUrl,
  kbApi,
  notesApi,
  type DocumentImageItem,
} from "@/lib/api"
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

/** 从 img src 或 markdown 路径解析图床文件名 */
export function tipImageFileName(src: string | null | undefined): string | null {
  if (!src) return null
  try {
    const path = src.startsWith("http") ? new URL(src).pathname : src
    const m = path.match(/\/images\/([^/?#]+)$/i) || path.match(/(?:^|\/)images\/([^/?#]+)$/i)
    if (m) return decodeURIComponent(m[1])
    // 已是纯文件名
    if (!/[\\/]/.test(src) && /\.(png|jpe?g|gif|webp|bmp)$/i.test(src)) return src
  } catch {
    /* ignore */
  }
  return null
}

function buildTipContent(text: string, files: string[]): string {
  const parts: string[] = []
  const t = text.trim()
  if (t) parts.push(t)
  for (const f of files) {
    const name = f.trim()
    if (!name) continue
    parts.push(`![](images/${name})`)
  }
  return parts.join("\n\n")
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
  const [attachedImages, setAttachedImages] = useState<string[]>([])
  const [gallery, setGallery] = useState<DocumentImageItem[]>([])
  const [galleryLoading, setGalleryLoading] = useState(false)

  const resetForm = () => {
    setTitle("")
    setContent("")
    setSelectedTags([])
    setTagDraft("")
    setAttachedImages([])
    setGallery([])
  }

  const openFromSelection = (text: string, files: string[] = []) => {
    setContent(text)
    setAttachedImages(files)
    setTitle(
      pageNumber != null
        ? `第 ${pageNumber} 页摘录`
        : text
          ? `tip · ${text.slice(0, 16)}`
          : files.length
            ? `第 ${pageNumber ?? "?"} 页图片`
            : "tip",
    )
    setOpen(true)
    setAnchor(null)
  }

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
      // 点选正文图：阻止默认选中，交给 click 开 tip
      const img = t?.closest?.("img") as HTMLImageElement | null
      if (img?.closest("[data-tip-doc]") && !img.closest(IGNORE)) {
        e.preventDefault()
        return
      }
      window.setTimeout(() => {
        if (!window.getSelection()?.toString().trim()) hide()
      }, 0)
    }

    const onImgClick = (e: MouseEvent) => {
      if (open) return
      const t = e.target as HTMLElement | null
      const img = t?.closest?.("img") as HTMLImageElement | null
      if (!img || !img.closest("[data-tip-doc]") || img.closest(IGNORE)) return
      const file = tipImageFileName(img.getAttribute("src") || img.currentSrc)
      if (!file) return
      e.preventDefault()
      e.stopPropagation()
      window.getSelection()?.removeAllRanges()
      const pageRaw = closestAttr(img, "[data-page]", "data-page")
      const fromDom = closestAttr(img, "[data-tip-doc]", "data-tip-doc")
      const page = pageRaw && Number.isFinite(Number(pageRaw)) ? Number(pageRaw) : null
      setPageNumber(page)
      setDocId(fromDom || inferDocId(location.pathname, location.search) || "")
      setContent("")
      setAttachedImages([file])
      setTitle(page != null ? `第 ${page} 页图片` : `图片 · ${file.slice(0, 20)}`)
      setOpen(true)
      setAnchor(null)
    }

    document.addEventListener("mouseup", maybeShow)
    document.addEventListener("keyup", maybeShow)
    document.addEventListener("mousedown", onMouseDown)
    document.addEventListener("click", onImgClick, true)
    document.addEventListener("scroll", hide, true)
    return () => {
      document.removeEventListener("mouseup", maybeShow)
      document.removeEventListener("keyup", maybeShow)
      document.removeEventListener("mousedown", onMouseDown)
      document.removeEventListener("click", onImgClick, true)
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
          (Array.isArray(raw) ? raw : [])
            .map((d: { id?: string; name?: string; display_name?: string }) => ({
              id: String(d.id || ""),
              name: String(d.name || d.display_name || "未命名资料"),
            }))
            .filter((d: { id: string }) => d.id),
        )
      })
      .catch(() => setDocs([]))
    notesApi
      .listTipTags()
      .then((res) => setKnownTags(res.tags || []))
      .catch(() => setKnownTags([]))
  }, [open])

  // 本页图库（无本页图时回退全书）
  useEffect(() => {
    if (!open || !docId) {
      setGallery([])
      return
    }
    let cancelled = false
    setGalleryLoading(true)
    const load = async () => {
      try {
        let res = await kbApi.listDocumentImages(docId, pageNumber)
        let imgs = res.images || []
        if (imgs.length === 0 && pageNumber != null) {
          res = await kbApi.listDocumentImages(docId, null)
          imgs = res.images || []
        }
        if (!cancelled) setGallery(imgs)
      } catch {
        if (!cancelled) setGallery([])
      } finally {
        if (!cancelled) setGalleryLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [open, docId, pageNumber])

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

  const toggleImage = (file: string) => {
    setAttachedImages((prev) =>
      prev.includes(file) ? prev.filter((f) => f !== file) : [...prev, file],
    )
  }

  const canSave = Boolean(content.trim() || attachedImages.length) && !saving

  const handleSave = async () => {
    const body = buildTipContent(content, attachedImages)
    if (!body || saving) return
    setSaving(true)
    try {
      await notesApi.saveTip({
        document_id: docId || null,
        page_number: pageNumber,
        title:
          title.trim() ||
          (pageNumber != null
            ? `第 ${pageNumber} 页摘录`
            : content.trim().slice(0, 24) || "图片 tip"),
        content: body,
        tags: selectedTags,
      })
      toast.success("已收入 tip")
      setOpen(false)
      setAnchor(null)
      resetForm()
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
          onClick={() => openFromSelection(anchor.text)}
          className="fixed z-[70] inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-ink text-paper text-caption font-medium shadow-[0_8px_24px_rgba(20,33,43,0.18)] hover:bg-sea transition-colors"
          style={{ left: anchor.x, top: anchor.y, transform: "translateX(-50%)" }}
        >
          <StickyNote className="w-3.5 h-3.5" strokeWidth={2} />
          tip
        </button>
      )}

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v)
          if (!v) {
            setAnchor(null)
            resetForm()
          }
        }}
      >
        <DialogContent className="max-w-md" data-tip-dialog>
          <DialogHeader>
            <DialogTitle>收入 tip</DialogTitle>
            <DialogDescription>
              划选文字或点选解析稿里的图片。tag 是你自己用来分类的，不是知识点。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="block text-caption text-ink-soft mb-1">划选内容</label>
              <div className="rounded-r-xl border-l-[3px] border-sea bg-sea-subtle/70 px-3 py-2 text-small text-ink leading-relaxed max-h-24 overflow-y-auto whitespace-pre-wrap min-h-[2.5rem]">
                {content || <span className="text-ink-disabled">（未划选文字，可只选图片）</span>}
              </div>
            </div>

            {docId ? (
              <div>
                <label className="block text-caption text-ink-soft mb-1">
                  本页图片{pageNumber != null ? ` · 第 ${pageNumber} 页` : ""}
                  {attachedImages.length > 0 ? ` · 已选 ${attachedImages.length}` : ""}
                </label>
                {galleryLoading ? (
                  <p className="text-caption text-ink-disabled py-2">加载图库…</p>
                ) : gallery.length === 0 ? (
                  <p className="text-caption text-ink-disabled py-2">
                    这份资料没有可选用的插图（原 PDF/未解析出图时为空）。
                  </p>
                ) : (
                  <div className="grid grid-cols-4 gap-2 max-h-36 overflow-y-auto scroll-thin">
                    {gallery.map((img) => {
                      const on = attachedImages.includes(img.file_name)
                      return (
                        <button
                          key={img.file_name}
                          type="button"
                          title={img.file_name}
                          onClick={() => toggleImage(img.file_name)}
                          className={cn(
                            "relative aspect-square rounded-lg border overflow-hidden bg-paper-2",
                            on ? "border-sea ring-2 ring-sea/30" : "border-line hover:border-sea/40",
                          )}
                        >
                          <img
                            src={documentImageUrl(docId, img.file_name)}
                            alt=""
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                          {on ? (
                            <span className="absolute top-1 right-1 h-4 min-w-4 px-1 rounded-full bg-sea text-paper text-[10px] leading-4">
                              ✓
                            </span>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            ) : null}

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
                onChange={(e) => {
                  setDocId(e.target.value)
                  setAttachedImages([])
                }}
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
            <Button onClick={() => void handleSave()} disabled={!canSave}>
              {saving ? "保存中…" : "收入 tip"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
