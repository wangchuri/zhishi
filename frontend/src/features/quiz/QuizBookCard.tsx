import { useState, type ReactNode } from "react"
import { FileText, RotateCw, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { getThumbnailUrl } from "@/lib/api"
import { cn } from "@/lib/utils"
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
  onDelete?: (e: React.MouseEvent) => void
  onReparse?: (e: React.MouseEvent) => void
}

function genStatusBadge(doc: KnowledgeDoc, hasQuestions?: boolean) {
  if (doc.question_gen_status === "processing") {
    return <Badge variant="warning" size="sm">出题中</Badge>
  }
  if (hasQuestions) {
    return <Badge variant="success" size="sm">可刷题</Badge>
  }
  if (doc.question_gen_status === "failed") {
    return <Badge variant="danger" size="sm">出题失败</Badge>
  }
  return <Badge variant="neutral" size="sm">未出题</Badge>
}

/** 卡片上的小操作（重新解析 / 删除）：桌面靠 hover 出现在封面，手机上挪到卡片底部信息行。 */
function CardAction({
  label,
  ariaLabel,
  onClick,
  tone = "primary",
  className,
  children,
}: {
  label: string
  ariaLabel: string
  onClick: (e: React.MouseEvent) => void
  tone?: "primary" | "danger"
  className?: string
  children: ReactNode
}) {
  const run = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    onClick(e)
  }
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={run}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") run(e as unknown as React.MouseEvent)
      }}
      title={label}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-lg bg-surface/90 text-ink-tertiary",
        "shadow-xs backdrop-blur-sm transition-all",
        tone === "danger"
          ? "hover:bg-danger-soft hover:text-danger"
          : "hover:bg-primary-soft hover:text-primary",
        className,
      )}
    >
      {children}
    </span>
  )
}

export function QuizBookCard({ doc, stats, onClick, onDelete, onReparse }: QuizBookCardProps) {
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
      <div className="relative aspect-[3/4] bg-gradient-to-br from-primary/10 to-surface-soft overflow-hidden">
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

        {/* 封面上的操作钮：只在桌面（有 hover）出现；手机上在卡片底部信息行 */}
        {(onReparse || onDelete) && (
          <div className="absolute top-2 left-2 z-20 hidden gap-2 sm:flex sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
            {onReparse && (
              <CardAction
                label="重新解析"
                ariaLabel={`重新解析 ${doc.name}`}
                onClick={onReparse}
              >
                <RotateCw className="w-4 h-4" strokeWidth={2} />
              </CardAction>
            )}
            {onDelete && (
              <CardAction
                label="删除资料"
                ariaLabel={`删除 ${doc.name}`}
                onClick={onDelete}
                tone="danger"
              >
                <Trash2 className="w-4 h-4" strokeWidth={2} />
              </CardAction>
            )}
          </div>
        )}

        {/* 浮动统计覆盖层：hover 时从底部浮出。
            原来是「深黑渐变 + 白字」，和纸本风格不搭；改成与进度角标同款：
            浅色面 + backdrop-blur + 墨色字，细轨道，只占底部一条。 */}
        {stats && stats.total > 0 && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] p-3
                       bg-surface/90 backdrop-blur-sm border-t border-line-soft
                       translate-y-1.5 opacity-0 group-hover:translate-y-0 group-hover:opacity-100
                       transition-all duration-200"
          >
            <div className="text-small space-y-1">
              <div className="flex items-center justify-between text-ink-secondary">
                <span>进度</span>
                <span className="font-medium text-ink-primary tabular-nums">{progress}%</span>
              </div>
              <div className="h-1 rounded-full bg-surface-soft overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex justify-between text-caption text-ink-tertiary">
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
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
            {genStatusBadge(doc, (stats?.total ?? 0) > 0)}
            {stats && stats.wrong > 0 && (
              <span className="text-caption text-danger">{stats.wrong} 错</span>
            )}
            {stats && stats.unknown > 0 && (
              <span className="text-caption text-warning">{stats.unknown} 不会</span>
            )}
          </div>
          {/* 手机上封面不放按钮（会糊住封面），操作挪到这里 */}
          {(onReparse || onDelete) && (
            <div className="flex items-center gap-0.5 shrink-0 sm:hidden">
              {onReparse && (
                <CardAction
                  label="重新解析"
                  ariaLabel={`重新解析 ${doc.name}`}
                  onClick={onReparse}
                  className="h-7 w-7 bg-transparent shadow-none"
                >
                  <RotateCw className="w-4 h-4" strokeWidth={2} />
                </CardAction>
              )}
              {onDelete && (
                <CardAction
                  label="删除资料"
                  ariaLabel={`删除 ${doc.name}`}
                  onClick={onDelete}
                  tone="danger"
                  className="h-7 w-7 bg-transparent shadow-none"
                >
                  <Trash2 className="w-4 h-4" strokeWidth={2} />
                </CardAction>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  )
}
