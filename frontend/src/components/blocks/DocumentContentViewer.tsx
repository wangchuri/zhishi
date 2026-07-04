import { MarkdownWithMath } from "@/components/blocks/MarkdownWithMath"
import { PdfPageViewer } from "@/components/blocks/PdfPageViewer"
import { renderHighlightedContent } from "@/components/blocks/DocumentPreviewModal"
import { cn } from "@/lib/utils"

interface DocumentContentViewerProps {
  docId: string
  previewMode?: "pdf" | "text" | "markdown"
  content?: string
  pageNumber?: number | null
  charStart?: number | null
  charEnd?: number | null
  className?: string
}

export function DocumentContentViewer({
  docId,
  previewMode = "text",
  content = "",
  pageNumber = null,
  charStart = null,
  charEnd = null,
  className,
}: DocumentContentViewerProps) {
  if (previewMode === "pdf") {
    return (
      <div className={cn("flex flex-col gap-4 min-h-0", className)}>
        <PdfPageViewer docId={docId} pageNumber={pageNumber} />
        {content.trim() ? (
          <div className="border-t border-line-soft pt-4">
            <p className="text-caption text-ink-tertiary mb-2">OCR / 解析文本</p>
            <MarkdownWithMath className="text-body leading-relaxed">
              {content}
            </MarkdownWithMath>
          </div>
        ) : null}
      </div>
    )
  }

  if (previewMode === "markdown") {
    return (
      <MarkdownWithMath className={cn("text-body leading-relaxed", className)}>
        {content || "（空白页）"}
      </MarkdownWithMath>
    )
  }

  return (
    <pre className={cn("text-body text-ink-primary whitespace-pre-wrap font-sans leading-relaxed", className)}>
      {renderHighlightedContent(content, charStart, charEnd)}
    </pre>
  )
}
