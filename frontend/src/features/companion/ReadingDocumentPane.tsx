import { useEffect, useRef, useState, type RefObject } from "react"
import { Loader2 } from "lucide-react"
import mammoth from "mammoth"
import { MarkdownWithMath } from "@/components/blocks/MarkdownWithMath"
import { getApiBase, kbApi } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { DocumentPage } from "@/types"

export type ReadingViewMode = "pdf" | "docx" | "markdown" | "text"

const readingProseClass =
  "prose prose-lg max-w-none prose-headings:text-ink prose-p:text-ink prose-p:my-2 prose-strong:text-ink prose-a:text-sea prose-code:bg-paper-2 prose-code:px-1 prose-code:rounded prose-code:text-small prose-pre:bg-paper-2 prose-pre:border prose-pre:border-line prose-ul:my-2 prose-ol:my-2"

/** 占位高度；已读过的页会记住真实高度，减轻跳动 */
const PLACEHOLDER_MIN_PX = 560
/** 只挂载当前页 ±N；离开即卸载，释放图片解码内存 */
const MOUNT_RADIUS = 1

interface ReadingDocumentPaneProps {
  docId: string
  viewMode: ReadingViewMode
  pageList: DocumentPage[]
  loading?: boolean
  className?: string
  scrollRootRef?: RefObject<HTMLElement | null>
  activePage?: number | null
}

function imageBaseFor(docId: string): string {
  const base = getApiBase().replace(/\/$/, "")
  return `${base}/api/v1/kb/documents/${encodeURIComponent(docId)}/images`
}

function WindowedMarkdownPage({
  docId,
  pageNumber,
  live,
  isLast,
  heightHint,
  onHeight,
}: {
  docId: string
  pageNumber: number
  live: boolean
  isLast: boolean
  heightHint: number
  onHeight: (page: number, h: number) => void
}) {
  const sectionRef = useRef<HTMLElement>(null)
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!live) {
      setText(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    kbApi
      .getDocumentPage(docId, pageNumber)
      .then((detail) => {
        if (!cancelled) setText(detail.content || "")
      })
      .catch(() => {
        if (!cancelled) setText("（本页加载失败）")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [live, docId, pageNumber])

  useEffect(() => {
    if (!live || loading || text == null) return
    const el = sectionRef.current
    if (!el) return
    const h = el.offsetHeight
    if (h > 80) onHeight(pageNumber, h)
  }, [live, loading, text, pageNumber, onHeight])

  return (
    <section
      ref={sectionRef}
      data-page={pageNumber}
      className="min-w-0"
      style={live ? undefined : { minHeight: heightHint }}
    >
      {live ? (
        loading || text == null ? (
          <div
            className="rounded-lg border border-dashed border-line-light bg-paper-2/60 px-4 py-10 text-center text-caption text-ink-disabled flex items-center justify-center gap-2"
            style={{ minHeight: Math.min(heightHint, 320) }}
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            第 {pageNumber} 页…
          </div>
        ) : (
          <MarkdownWithMath proseClass={readingProseClass} imageBaseUrl={imageBaseFor(docId)}>
            {text.trim() || "（本页无文本）"}
          </MarkdownWithMath>
        )
      ) : (
        <div
          className="rounded-lg border border-dashed border-line-light/80 bg-paper-2/40 px-4 py-8 text-center text-caption text-ink-disabled"
          style={{ minHeight: heightHint - 24 }}
          aria-hidden
        >
          第 {pageNumber} 页
        </div>
      )}
      {!isLast && <hr className="my-10 border-line-light" />}
    </section>
  )
}

export function ReadingDocumentPane({
  docId,
  viewMode,
  pageList,
  loading,
  className,
  activePage = null,
}: ReadingDocumentPaneProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [docxHtml, setDocxHtml] = useState("")
  const [fileError, setFileError] = useState<string | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [fallbackText, setFallbackText] = useState<string | null>(null)
  const heightsRef = useRef<Map<number, number>>(new Map())
  const [, bump] = useState(0)

  const rememberHeight = (page: number, h: number) => {
    const prev = heightsRef.current.get(page)
    if (prev != null && Math.abs(prev - h) < 24) return
    heightsRef.current.set(page, h)
    bump((n) => n + 1)
  }

  useEffect(() => {
    if (viewMode !== "pdf" && viewMode !== "docx") {
      setBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      setDocxHtml("")
      setFileError(null)
      return
    }

    let cancelled = false
    let objectUrl: string | null = null
    setFileLoading(true)
    setFileError(null)
    setDocxHtml("")

    kbApi
      .fetchDocumentFile(docId)
      .then(async (blob) => {
        if (cancelled) return
        if (viewMode === "pdf") {
          objectUrl = URL.createObjectURL(blob)
          setBlobUrl(objectUrl)
          return
        }
        const buffer = await blob.arrayBuffer()
        const result = await mammoth.convertToHtml({ arrayBuffer: buffer })
        if (!cancelled) setDocxHtml(result.value || "<p>（空白文档）</p>")
      })
      .catch((err: Error) => {
        if (!cancelled) setFileError(err.message || "无法打开原文件")
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false)
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [docId, viewMode])

  // 无分页时才拉全文，并按块窗口化
  useEffect(() => {
    if (viewMode !== "markdown" && viewMode !== "text") return
    if (pageList.length > 0) {
      setFallbackText(null)
      return
    }
    let cancelled = false
    setFileLoading(true)
    kbApi
      .getDocumentContent(docId)
      .then((meta) => {
        if (!cancelled) setFallbackText(meta.content || "")
      })
      .catch(() => {
        if (!cancelled) setFallbackText("")
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [docId, viewMode, pageList.length])

  if (loading || fileLoading) {
    return (
      <div className={cn("flex items-center justify-center py-24 text-ink-disabled gap-2", className)}>
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>加载文档…</span>
      </div>
    )
  }

  if (fileError) {
    return <div className={cn("flex items-center justify-center py-24 text-danger", className)}>{fileError}</div>
  }

  if (viewMode === "pdf") {
    if (!blobUrl) {
      return <div className={cn("flex items-center justify-center py-24 text-ink-disabled", className)}>暂无 PDF</div>
    }
    return (
      <iframe
        title="PDF 阅读"
        src={blobUrl}
        className={cn("w-full h-full min-h-[70vh] rounded-md border border-line-light bg-paper-2", className)}
      />
    )
  }

  if (viewMode === "docx") {
    return (
      <div
        className={cn("max-w-[820px] mx-auto reading-docx prose prose-lg text-ink", className)}
        dangerouslySetInnerHTML={{ __html: docxHtml || "<p>（空白文档）</p>" }}
      />
    )
  }

  if (pageList.length === 0) {
    if (!fallbackText?.trim()) {
      return <div className={cn("flex items-center justify-center py-24 text-ink-disabled", className)}>暂无内容</div>
    }
    const chunkSize = 6000
    const chunks: string[] = []
    for (let i = 0; i < fallbackText.length; i += chunkSize) {
      chunks.push(fallbackText.slice(i, i + chunkSize))
    }
    const focus = activePage ?? 1
    return (
      <div className={cn("max-w-[820px] mx-auto", className)}>
        {chunks.map((chunk, i) => {
          const pageNumber = i + 1
          const live = Math.abs(pageNumber - focus) <= MOUNT_RADIUS
          return (
            <section
              key={pageNumber}
              data-page={pageNumber}
              style={live ? undefined : { minHeight: PLACEHOLDER_MIN_PX }}
            >
              {live ? (
                <MarkdownWithMath proseClass={readingProseClass} imageBaseUrl={imageBaseFor(docId)}>
                  {chunk}
                </MarkdownWithMath>
              ) : (
                <div className="h-40 text-caption text-ink-disabled text-center py-8">第 {pageNumber} 段</div>
              )}
              {i < chunks.length - 1 && <hr className="my-10 border-line-light" />}
            </section>
          )
        })}
      </div>
    )
  }

  const focus = activePage ?? pageList[0]?.page_number ?? 1

  return (
    <div className={cn("max-w-[820px] mx-auto", className)}>
      {pageList.map((p, i) => {
        const live = Math.abs(p.page_number - focus) <= MOUNT_RADIUS
        const heightHint = heightsRef.current.get(p.page_number) ?? PLACEHOLDER_MIN_PX
        return (
          <WindowedMarkdownPage
            key={p.page_number}
            docId={docId}
            pageNumber={p.page_number}
            live={live}
            isLast={i === pageList.length - 1}
            heightHint={heightHint}
            onHeight={rememberHeight}
          />
        )
      })}
    </div>
  )
}
