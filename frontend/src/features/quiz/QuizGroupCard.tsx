import { useState } from "react"
import { FolderOpen, Layers } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { getThumbnailUrl } from "@/lib/api"
import type { DocumentGroupItem } from "@/types"

type QuizGroupCardProps = {
  group: DocumentGroupItem
  onClick?: () => void
}

export function QuizGroupCard({ group, onClick }: QuizGroupCardProps) {
  const [imgError, setImgError] = useState(false)
  const coverId = group.cover_document_id
  const coverUrl = coverId ? getThumbnailUrl(coverId) : null
  const stats = group.stats
  const progress =
    stats && stats.total > 0 ? Math.round((stats.answered / stats.total) * 100) : 0

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex flex-col rounded-xl border border-line-soft bg-surface shadow-xs overflow-hidden
                 transition-all duration-200 hover:shadow-md hover:border-primary/30 hover:-translate-y-0.5
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 text-left w-full"
    >
      <div className="relative aspect-[3/4] bg-gradient-to-br from-sea/15 to-surface-soft overflow-hidden">
        {coverUrl && !imgError ? (
          <img
            src={coverUrl}
            alt={group.name}
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-ink-tertiary">
            <Layers className="w-10 h-10" strokeWidth={1.5} />
            <span className="text-caption text-center px-2 line-clamp-2">{group.name}</span>
          </div>
        )}
        <div className="absolute top-2 left-2">
          <Badge variant="primary" size="sm">
            <FolderOpen className="w-3 h-3 mr-0.5" />
            资料组
          </Badge>
        </div>
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/55 to-transparent px-2.5 py-2">
          <p className="text-caption text-white/90">{group.doc_count} 份资料</p>
        </div>
      </div>
      <div className="p-2.5 space-y-1.5">
        <p className="text-small font-medium text-ink-primary line-clamp-2 leading-snug">{group.name}</p>
        {stats && stats.total > 0 ? (
          <div className="space-y-1">
            <div className="h-1 rounded-full bg-line-soft overflow-hidden">
              <div className="h-full bg-primary rounded-full" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-caption text-ink-tertiary">
              {stats.answered}/{stats.total} · 对 {stats.correct} / 错 {stats.wrong}
            </p>
          </div>
        ) : (
          <p className="text-caption text-ink-tertiary">暂无题目</p>
        )}
      </div>
    </button>
  )
}
