import { useState } from "react"
import { FileText } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { getThumbnailUrl } from "@/lib/api"
import type { KnowledgeDoc } from "@/types"

export interface BookCardStats {
  total: number
  answered: number
  correct: number
  wrong: number
  unknown: number
}

type QuizBookCardProps = {
  doc: KnowledgeDoc
  stats?: BookCardStats | null
  onClick?: () => void
}

function genStatusBadge(doc: KnowledgeDoc) {
  if (doc.question_gen_status === "processing") {
    return <Badge variant="warning" size="sm">出题中</Badge>
  }
  if (doc.question_gen_status === "completed") {
    return <Badge variant="success" size="sm">可刷题</Badge>
  }
  return <Badge variant="neutral" size="sm">未出题</Badge>
}

export function QuizBookCard({ doc, stats, onClick }: QuizBookCardProps) {
  const [imgError, setImgError] = useState(false)

  const coverUrl = getThumbnailUrl(doc.id)
  const progress = stats && stats.total > 0 ? Math.round((stats.answered / stats.total) * 100) : 0

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex flex-col rounded-xl border border-line-soft bg-surface shadow-xs overflow-hidden
                 transition-all duration-200 hover:shadow-md hover:border-primary/30 hover:-translate-y-0.5
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 text-left w-full"
    >
      {/* 封面图 */}
      <div className="relative aspect-[3/4] bg-gradient-to-br from-primary-soft/30 to-surface-soft overflow-hidden">
        {!imgError ? (
          <img
            src={coverUrl}
            alt={doc.name}
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-ink-tertiary">
            <FileText className="w-10 h-10" strokeWidth={1.5} />
            <span className="text-caption text-center px-2 line-clamp-2">{doc.name}</span>
          </div>
        )}

        {/* 浮动统计覆盖层 */}
        {stats && stats.total > 0 && (
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent
                          flex flex-col justify-end p-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <div className="text-white text-small space-y-1">
              <div className="flex items-center justify-between">
                <span>进度</span>
                <span className="font-medium">{progress}%</span>
              </div>
              <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex justify-between text-caption text-white/80 mt-1">
                <span>已做 {stats.answered}</span>
                <span>共 {stats.total} 题</span>
              </div>
            </div>
          </div>
        )}

        {/* 进度角标（一直显示） */}
        {stats && stats.total > 0 && (
          <div className="absolute top-2 right-2 bg-surface/90 backdrop-blur-sm rounded-full px-2 py-0.5 text-caption font-medium text-ink-primary shadow-xs">
            {stats.answered}/{stats.total}
          </div>
        )}
      </div>

      {/* 底部信息 */}
      <div className="p-3 space-y-1.5">
        <div className="text-small font-medium text-ink-primary line-clamp-1 leading-tight">
          {doc.name}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {genStatusBadge(doc)}
          {stats && stats.wrong > 0 && (
            <span className="text-caption text-danger">{stats.wrong} 错</span>
          )}
          {stats && stats.unknown > 0 && (
            <span className="text-caption text-warning">{stats.unknown} 不会</span>
          )}
        </div>
      </div>
    </button>
  )
}