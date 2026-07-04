import { useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist"
import { usePdfDocument } from "@/hooks/usePdfDocument"
import { cn } from "@/lib/utils"

const MAX_CSS_SCALE = 2

function setupCanvasForViewport(
  canvas: HTMLCanvasElement,
  viewport: ReturnType<PDFPageProxy["getViewport"]>,
  outputScale: number,
) {
  canvas.width = viewport.width
  canvas.height = viewport.height
  canvas.style.width = `${Math.floor(viewport.width / outputScale)}px`
  canvas.style.height = `${Math.floor(viewport.height / outputScale)}px`
}

function isRenderCancelled(err: unknown): boolean {
  return err instanceof Error && err.name === "RenderingCancelledException"
}

interface PdfPageCanvasProps {
  pdf: PDFDocumentProxy
  pageNumber: number
  className?: string
  lazy?: boolean
}

function PdfPageCanvas({ pdf, pageNumber, className, lazy = false }: PdfPageCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderTaskRef = useRef<RenderTask | null>(null)
  const [visible, setVisible] = useState(!lazy)
  const [rendering, setRendering] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => {
    if (!lazy) return
    const el = containerRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisible(true)
      },
      { rootMargin: "240px" },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [lazy])

  useEffect(() => {
    if (!visible) return

    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    let cancelled = false

    renderTaskRef.current?.cancel()
    renderTaskRef.current = null

    setRendering(true)
    setRenderError(null)

    const width = container.clientWidth || 800

    ;(async () => {
      try {
        const page = await pdf.getPage(pageNumber)
        if (cancelled) return

        const baseViewport = page.getViewport({ scale: 1 })
        const cssScale = Math.min(width / baseViewport.width, MAX_CSS_SCALE)
        const outputScale = window.devicePixelRatio || 1
        const viewport = page.getViewport({ scale: cssScale * outputScale })

        setupCanvasForViewport(canvas, viewport, outputScale)

        const ctx = canvas.getContext("2d")
        if (!ctx) {
          throw new Error("Canvas 不可用")
        }
        if (cancelled) return

        const renderTask = page.render({ canvasContext: ctx, viewport, canvas })
        renderTaskRef.current = renderTask

        await renderTask.promise
        if (cancelled) return
      } catch (err: unknown) {
        if (!cancelled && !isRenderCancelled(err)) {
          const message = err instanceof Error ? err.message : "页面渲染失败"
          setRenderError(message)
        }
      } finally {
        if (!cancelled) {
          renderTaskRef.current = null
          setRendering(false)
        }
      }
    })()

    return () => {
      cancelled = true
      renderTaskRef.current?.cancel()
      renderTaskRef.current = null
    }
  }, [visible, pdf, pageNumber])

  return (
    <div
      ref={containerRef}
      className={cn("relative flex justify-center bg-surface-soft rounded-md min-h-[120px]", className)}
    >
      {rendering && (
        <div className="absolute inset-0 flex items-center justify-center text-ink-tertiary">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          <span className="text-caption">渲染第 {pageNumber} 页…</span>
        </div>
      )}
      {renderError ? (
        <div className="p-4 text-caption text-danger">{renderError}</div>
      ) : (
        <canvas ref={canvasRef} className={cn("max-w-full", rendering && "opacity-0")} />
      )}
    </div>
  )
}

interface PdfPageViewerProps {
  docId: string
  pageNumber?: number | null
  className?: string
}

export function PdfPageViewer({ docId, pageNumber = null, className }: PdfPageViewerProps) {
  const { pdf, loading, error } = usePdfDocument(docId, true)

  if (loading) {
    return (
      <div className={cn("flex items-center justify-center py-16 text-ink-tertiary", className)}>
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        加载 PDF…
      </div>
    )
  }

  if (error) {
    return <div className={cn("p-5 text-body text-danger", className)}>{error}</div>
  }

  if (!pdf) {
    return (
      <div className={cn("p-5 text-body text-ink-tertiary", className)}>
        原始 PDF 不可用
      </div>
    )
  }

  if (pageNumber != null) {
    return (
      <PdfPageCanvas
        pdf={pdf}
        pageNumber={pageNumber}
        className={cn("min-h-[560px]", className)}
      />
    )
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {Array.from({ length: pdf.numPages }, (_, index) => (
        <PdfPageCanvas
          key={index + 1}
          pdf={pdf}
          pageNumber={index + 1}
          lazy={index > 0}
        />
      ))}
    </div>
  )
}
