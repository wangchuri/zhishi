import { Loader2 } from "lucide-react"
import { PdfPageCanvas } from "@/components/blocks/PdfPageViewer"
import { usePdfDocument, type PdfSource } from "@/hooks/usePdfDocument"

interface PdfContinuousViewerProps {
  source: PdfSource
}

/**
 * PDF 连续阅读视图：一次性加载 PDF，所有页自上而下排布，
 * 随滚动自动进入下一页（每页带 data-page 供阅读页追踪）。
 */
export function PdfContinuousViewer({ source }: PdfContinuousViewerProps) {
  const { pdf, loading, error } = usePdfDocument(source, true)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-ink-disabled gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>加载 PDF…</span>
      </div>
    )
  }
  if (error || !pdf) {
    return <div className="p-5 text-body text-danger">{error || "原始 PDF 不可用"}</div>
  }

  return (
    <div className="space-y-10">
      {Array.from({ length: pdf.numPages }, (_, i) => i + 1).map((n) => (
        <div key={n} data-page={n} className="mx-auto max-w-[880px]">
          <div className="text-caption text-ink-disabled mb-1.5">第 {n} 页</div>
          <PdfPageCanvas pdf={pdf} pageNumber={n} lazy />
        </div>
      ))}
    </div>
  )
}
