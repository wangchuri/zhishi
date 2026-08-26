import { MarkdownWithMath } from "@/components/blocks/MarkdownWithMath"
import { renderHighlightedContent } from "@/components/blocks/DocumentPreviewModal"
import { getApiBase } from "@/lib/api"
import { cn } from "@/lib/utils"

function imageBaseFor(docId: string): string {
  const base = getApiBase().replace(/\/$/, "")
  return `${base}/api/v1/kb/documents/${encodeURIComponent(docId)}/images`
}

interface DocumentContentViewerProps {
  docId: string
  previewMode?: "pdf" | "text" | "markdown"
  content?: string
  charStart?: number | null
  charEnd?: number | null
  className?: string
}

export function DocumentContentViewer({
  docId,
  previewMode = "text",
  content = "",
  charStart = null,
  charEnd = null,
  className,
}: DocumentContentViewerProps) {
  const useMarkdown = previewMode === "markdown" || previewMode === "pdf"
  // 所有文档（含扫描件）统一按 markdown 预览
  if (useMarkdown) {
    return (
      <MarkdownWithMath
        className={cn("text-body leading-relaxed", className)}
        imageBaseUrl={imageBaseFor(docId)}
      >
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
