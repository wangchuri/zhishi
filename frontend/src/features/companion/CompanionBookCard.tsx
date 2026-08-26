import { useState } from "react"
import { BookOpen, FileText, Pin } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { getThumbnailUrl } from "@/lib/api"
import type { KnowledgeDoc } from "@/types"

interface CompanionBookCardProps {
  doc: KnowledgeDoc
  totalPages?: number | null
  progress?: number | null
  tipCount: number
  markedCount: number
  onClick?: () => void
}

function genStatusBadge(doc: KnowledgeDoc) {
  if (doc.ocr_status === "processing") {
    return <Badge variant="warning" size="sm">解析中</Badge>
  }
  if (doc.status === "processing") {
    return <Badge variant="warning" size="sm">处理中</Badge>
  }
  if (doc.status === "failed") {
    return <Badge variant="danger" size="sm">失败</Badge>
  }
  return <Badge variant="success" size="sm">可阅读</Badge>
}

export function CompanionBookCard({
  doc,
  totalPages = null,
  progress = null,
  tipCount,
  markedCount,
  onClick,
}: CompanionBookCardProps) {
  const [imgError, setImgError] = useState(false)
  const coverUrl = getThumbnailUrl(doc.id)

  const progressLabel =
    progress == null
      ? "未开始"
      : totalPages != null
        ? `第 ${progress} / ${totalPages} 页`
        : `第 ${progress} 页`

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex flex-col rounded-xl border border-line-light bg-paper shadow-xs overflow-hidden
                 transition-all duration-200 hover:shadow-md hover:border-sea/30 hover:-translate-y-0.5
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-sea/50 text-left w-full"
    >
      {/* 封面 */}
      <div className="relative aspect-[3/4] bg-gradient-to-br from-sea-subtle to-paper-2 overflow-hidden">
        {!imgError ? (
          <img
            src={coverUrl}
            alt={doc.name}
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-ink-disabled">
            <BookOpen className="w-10 h-10" strokeWidth={1.5} />
            <span className="text-caption text-center px-2 line-clamp-2">{doc.name}</span>
          </div>
        )}

        {/* 进度角标 */}
        {progress != null && (
          <div className="absolute top-2 right-2 bg-paper/90 backdrop-blur-sm rounded-full px-2 py-0.5 text-caption font-medium text-ink shadow-xs">
            {progressLabel}
          </div>
        )}
      </div>

      {/* 底部信息 */}
      <div className="p-3 space-y-1.5">
        <div className="text-small font-medium text-ink line-clamp-1 leading-tight">
          {doc.name}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {genStatusBadge(doc)}
          <span className="flex items-center gap-1 text-caption text-ink-disabled">
            <Pin className="w-3 h-3" strokeWidth={2} />
            {markedCount} 重点
          </span>
          <span className="flex items-center gap-1 text-caption text-ink-disabled">
            <FileText className="w-3 h-3" strokeWidth={2} />
            {tipCount} tip
          </span>
        </div>
      </div>
    </button>
  )
}
