import type { KnowledgeDoc } from "@/types"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const typeLabels: Record<KnowledgeDoc["type"], string> = {
  pdf: "PDF",
  txt: "TXT",
  md: "MD",
  docx: "DOCX",
  image: "图片",
  ocr: "OCR",
}

const statusConfig: Record<
  KnowledgeDoc["status"],
  { label: string; variant: "success" | "warning" | "danger" | "neutral" }
> = {
  indexed: { label: "已入库", variant: "success" },
  processing: { label: "处理中", variant: "warning" },
  failed: { label: "解析失败", variant: "danger" },
  pending: { label: "待整理", variant: "neutral" },
}

interface DocRowProps {
  doc: KnowledgeDoc
  className?: string
}

/** 知识库文档行 · 表格风格要轻，不像传统后台厚重表格 */
export function DocRow({ doc, className }: DocRowProps) {
  const status = statusConfig[doc.status]
  return (
    <div
      className={cn(
        "grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,2fr)_auto_auto_auto_auto] gap-x-4 gap-y-2 items-center px-5 py-3.5 hover:bg-surface-soft transition-colors group",
        className
      )}
    >
      {/* 文档名 + 标签 */}
      <div className="min-w-0">
        <div className="text-body text-ink-primary font-medium truncate-1 group-hover:text-primary transition-colors">
          {doc.name}
        </div>
        {doc.tags.length > 0 && (
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {doc.tags.map((t) => (
              <span key={t} className="text-small text-ink-tertiary">
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 类型 */}
      <div className="hidden sm:block">
        <span className="inline-flex items-center justify-center min-w-[44px] h-6 px-2 rounded-sm bg-surface-soft text-small text-ink-secondary font-medium">
          {typeLabels[doc.type]}
        </span>
      </div>

      {/* 字数 */}
      <div className="hidden sm:block text-small text-ink-tertiary tabular-nums">{doc.wordCount}</div>

      {/* 更新时间 */}
      <div className="hidden sm:block text-small text-ink-tertiary">{doc.updatedAt}</div>

      {/* 状态 */}
      <div className="flex items-center gap-2 justify-self-end">
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>
    </div>
  )
}
