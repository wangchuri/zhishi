import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useLocation } from "react-router-dom"
import { StickyNote } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { documentImageUrl, kbApi, notesApi } from "@/lib/api"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

const MIN_LEN = 2
const IGNORE = "input, textarea, select, [contenteditable='true'], #app-sidebar, [data-no-tip]"
const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "LI",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "TR",
  "SECTION",
  "ARTICLE",
  "BLOCKQUOTE",
  "PRE",
  "UL",
  "OL",
])
const KEEP_TAGS = new Set([
  "P",
  "DIV",
  "SPAN",
  "BR",
  "IMG",
  "STRONG",
  "B",
  "EM",
  "I",
  "U",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "UL",
  "OL",
  "CODE",
  "PRE",
  "BLOCKQUOTE",
  "SUP",
  "SUB",
])

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
    if (!/[\\/]/.test(src) && /\.(png|jpe?g|gif|webp|bmp)$/i.test(src)) return src
  } catch {
    /* ignore */
  }
  return null
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function plainToHtml(text: string): string {
  const t = text.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim()
  if (!t) return ""
  return `<p>${escapeHtml(t).replace(/\n/g, "<br>")}</p>`
}

function sanitizeFragment(root: ParentNode): string {
  const dest = document.createElement("div")
  const copy = (from: Node, to: HTMLElement) => {
    for (const child of Array.from(from.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        to.appendChild(document.createTextNode(child.textContent || ""))
        continue
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue
      const el = child as HTMLElement
      const tag = el.tagName
      if (tag === "IMG") {
        const src = el.getAttribute("src") || (el as HTMLImageElement).currentSrc
        if (!src) continue
        const img = document.createElement("img")
        img.src = src
        img.alt = el.getAttribute("alt") || ""
        to.appendChild(img)
        continue
      }
      if (!KEEP_TAGS.has(tag)) {
        copy(el, to)
        continue
      }
      const next = document.createElement(tag.toLowerCase())
      copy(el, next)
      to.appendChild(next)
    }
  }
  copy(root, dest)
  return dest.innerHTML
}

function rangeToEditorHtml(range: Range): string {
  const html = sanitizeFragment(range.cloneContents())
  const stripped = html.replace(/<br\s*\/?>/gi, "").replace(/&nbsp;/gi, " ").replace(/<[^>]+>/g, "").trim()
  if (html.trim() && stripped) return html
  if (html.includes("<img")) return html
  return plainToHtml(range.toString())
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || ""
  if (node.nodeType !== Node.ELEMENT_NODE) return ""
  const el = node as HTMLElement
  const tag = el.tagName
  if (tag === "BR") return "\n"
  if (tag === "IMG") {
    const file = tipImageFileName(el.getAttribute("src") || (el as HTMLImageElement).currentSrc)
    return file ? `\n\n![](images/${file})\n\n` : ""
  }
  let inner = ""
  for (const child of Array.from(el.childNodes)) inner += serializeNode(child)
  if (BLOCK_TAGS.has(tag)) return `${inner.replace(/\s+$/, "")}\n\n`
  return inner
}

function htmlToTipMarkdown(html: string): string {
  const root = document.createElement("div")
  root.innerHTML = html
  return serializeNode(root)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** 不受父组件 tag/资料列表更新影响，避免 React 把 contentEditable 清空。 */
const TipExcerptEditor = memo(function TipExcerptEditor({
  initialHtml,
  onReady,
  onInput,
}: {
  initialHtml: string
  onReady: (el: HTMLDivElement | null) => void
  onInput: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = initialHtml
    el.focus()
  }, [initialHtml])
  return (
    <div
      ref={(node) => {
        ref.current = node
        onReady(node)
      }}
      contentEditable
      data-no-tip
      suppressContentEditableWarning
      role="textbox"
      aria-label="摘录内容"
      onInput={onInput}
      className="min-h-0 flex-1 overflow-y-auto scroll-thin px-5 py-3 text-body text-ink leading-relaxed outline-none whitespace-pre-wrap [&_img]:my-2 [&_img]:max-h-64 [&_img]:max-w-full [&_img]:rounded-md [&_p]:my-2 [&_h1]:text-lg [&_h2]:text-base [&_li]:my-0.5"
    />
  )
}, (a, b) => a.initialHtml === b.initialHtml)

export function GlobalTipCapture() {
  const location = useLocation()
  const editorRef = useRef<HTMLDivElement>(null)
  const pendingHtmlRef = useRef("")
  const [anchor, setAnchor] = useState<{ html: string; text: string; x: number; y: number } | null>(null)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [draftHtml, setDraftHtml] = useState("")
  const [saving, setSaving] = useState(false)
  const [docId, setDocId] = useState("")
  const [pageNumber, setPageNumber] = useState<number | null>(null)
  const [docs, setDocs] = useState<Array<{ id: string; name: string }>>([])
  const [knownTags, setKnownTags] = useState<string[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState("")
  const [canSave, setCanSave] = useState(false)

  const resetForm = () => {
    setTitle("")
    setDraftHtml("")
    setSelectedTags([])
    setTagDraft("")
    setCanSave(false)
    pendingHtmlRef.current = ""
    if (editorRef.current) editorRef.current.innerHTML = ""
  }

  const openEditor = (html: string, text: string, page: number | null = pageNumber) => {
    const next = html.trim() || plainToHtml(text)
    pendingHtmlRef.current = next
    setDraftHtml(next)
    setCanSave(Boolean(htmlToTipMarkdown(next)))
    setTitle(
      page != null
        ? `第 ${page} 页摘录`
        : text
          ? `tip · ${text.replace(/\s+/g, " ").trim().slice(0, 16)}`
          : html.includes("<img")
            ? "图片 tip"
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
      const text = sel.toString().replace(/\u00a0/g, " ").replace(/\r\n/g, "\n").trim()
      const range = sel.getRangeAt(0)
      const html = rangeToEditorHtml(range)
      if (text.length < MIN_LEN && !html.includes("<img")) {
        hide()
        return
      }
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
        html,
        text,
        x: Math.min(Math.max(rect.left + rect.width / 2, 80), window.innerWidth - 80),
        y: Math.min(Math.max(rect.bottom + 8, 8), window.innerHeight - 56),
      })
    }

    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest("[data-tip-fab], [data-tip-dialog]")) return
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
      const linked = fromDom || inferDocId(location.pathname, location.search) || ""
      setPageNumber(page)
      setDocId(linked)
      const src = linked ? documentImageUrl(linked, file) : img.currentSrc || img.src
      openEditor(`<p><img src="${escapeHtml(src)}" alt=""></p>`, "", page)
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

  const bodyFromEditor = () => htmlToTipMarkdown(editorRef.current?.innerHTML || draftHtml)

  const handleSave = async () => {
    const body = bodyFromEditor()
    if (!body || saving) return
    setSaving(true)
    try {
      await notesApi.saveTip({
        document_id: docId || null,
        page_number: pageNumber,
        title:
          title.trim() ||
          (pageNumber != null ? `第 ${pageNumber} 页摘录` : body.replace(/!\[[^\]]*\]\([^)]+\)/g, "").trim().slice(0, 24) || "图片 tip"),
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
          onClick={() => openEditor(anchor.html, anchor.text)}
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
        <DialogContent
          data-tip-dialog
          showCloseButton
          overlayClassName="z-[80]"
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-[80] flex h-[min(40rem,calc(100vh-3rem))] w-[min(56rem,calc(100vw-2rem))] max-w-[min(56rem,calc(100vw-2rem))] sm:max-w-[min(56rem,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0"
        >
          <div className="shrink-0 border-b border-line px-5 py-4 pr-12">
            <DialogTitle className="font-display text-ink">收入 tip</DialogTitle>
            <DialogDescription className="mt-1">
              左侧是刚划选的内容，排版可改；右侧打 tag、关联资料后收入。
            </DialogDescription>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_minmax(17rem,20rem)]">
            <div className="flex min-h-0 flex-col border-b border-line bg-paper-deep md:border-b-0 md:border-r">
              <p className="shrink-0 px-5 pt-3 text-[11px] font-medium tracking-wide text-ink-soft">摘录</p>
              {open ? (
                <TipExcerptEditor
                  initialHtml={pendingHtmlRef.current || draftHtml}
                  onReady={(el) => {
                    editorRef.current = el
                  }}
                  onInput={() =>
                    setCanSave(Boolean(htmlToTipMarkdown(editorRef.current?.innerHTML || "")))
                  }
                />
              ) : null}
            </div>

            <div className="flex min-h-0 flex-col overflow-y-auto scroll-thin bg-paper px-5 py-4">
              <div className="space-y-3 flex-1">
                <div>
                  <label className="mb-1 block text-caption text-ink-soft">标题</label>
                  <input
                    type="text"
                    value={title}
                    maxLength={40}
                    onChange={(e) => setTitle(e.target.value)}
                    className="h-10 w-full rounded-xl border border-line bg-paper px-3 text-body text-ink focus:border-sea focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-caption text-ink-soft">关联资料</label>
                  <select
                    value={docId}
                    onChange={(e) => setDocId(e.target.value)}
                    className="h-10 w-full rounded-xl border border-line bg-paper px-3 text-body text-ink focus:border-sea focus:outline-none"
                  >
                    <option value="">不关联资料</option>
                    {docs.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                  {pageNumber != null ? (
                    <p className="mt-1 text-[11px] text-ink-disabled">当前页：第 {pageNumber} 页</p>
                  ) : null}
                </div>
                <div>
                  <label className="mb-1 block text-caption text-ink-soft">Tag</label>
                  {chipTags.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
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
                      className="h-10 flex-1 rounded-xl border border-line bg-paper px-3 text-body text-ink placeholder:text-ink-disabled focus:border-sea focus:outline-none"
                    />
                    <Button type="button" variant="outline" onClick={addDraftTag} disabled={!tagDraft.trim()}>
                      加上
                    </Button>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex shrink-0 justify-end gap-2 border-t border-line pt-4">
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  取消
                </Button>
                <Button onClick={() => void handleSave()} disabled={!canSave || saving}>
                  {saving ? "保存中…" : "收入 tip"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
