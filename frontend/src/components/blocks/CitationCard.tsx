import { FileText } from "lucide-react"
import type { Citation } from "@/types"
import { CitationPreviewButton } from "@/components/blocks/DocumentPreviewModal"
import { cn } from "@/lib/utils"

interface CitationCardProps {
  citation: Citation
  variant?: "default" | "compact" | "inline"
  showIndex?: number
  className?: string
}

/** 统一引用卡片：snippet + 查看原文按钮 */
export function CitationCard({
  citation,
  variant = "default",
  showIndex,
  className,
}: CitationCardProps) {
  if (!citation.doc_id && !citation.snippet) return null

  if (variant === "inline") {
    return (
      <CitationPreviewButton
        citation={citation}
        label={citation.title || "查看原文"}
        className={cn("text-small text-primary hover:underline", className)}
      />
    )
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-line-soft bg-surface-soft border-l-2 border-l-primary/40",
        variant === "compact" ? "p-2.5 space-y-1.5" : "p-3 space-y-2",
        className
      )}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <FileText className="w-3.5 h-3.5 text-primary shrink-0" strokeWidth={2} />
        <span className="text-small font-medium text-ink-primary truncate">
          {showIndex != null && `${showIndex}. `}
          {citation.title || "原文引用"}
        </span>
      </div>
      {citation.snippet && (
        <p
          className={cn(
            "text-ink-secondary line-clamp-3",
            variant === "compact" ? "text-caption" : "text-small"
          )}
        >
          {citation.snippet}
        </p>
      )}
      {citation.doc_id && (
        <CitationPreviewButton
          citation={citation}
          label="查看原文并高亮"
          className="text-small text-primary hover:underline"
        />
      )}
    </div>
  )
}
