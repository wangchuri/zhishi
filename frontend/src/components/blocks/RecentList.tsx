import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export interface RecentItem {
  id: string
  title: string
  meta: string
  icon?: LucideIcon
  iconTone?: "primary" | "neutral"
  secondaryAction?: { label: string; onClick: () => void }
}

interface RecentListProps {
  items: RecentItem[]
  className?: string
}

/** 最近内容列表 · 对应设计 12.1 最近内容（轻列表，不厚重） */
export function RecentList({ items, className }: RecentListProps) {
  return (
    <div className={cn("card-paper divide-y divide-line-light", className)}>
      {items.map((item) => {
        const Icon = item.icon
        return (
          <div
            key={item.id}
            className="flex items-center gap-3.5 px-4 py-3 hover:bg-paper-deep cursor-pointer transition-colors group"
          >
            {Icon && (
              <div
                className={cn(
                  "w-9 h-9 rounded-[4px] flex items-center justify-center shrink-0",
                  item.iconTone === "primary" ? "bg-sea-subtle text-sea" : "bg-paper-2 text-ink-soft"
                )}
              >
                <Icon className="w-4 h-4" strokeWidth={2} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-body text-ink font-medium truncate-1 group-hover:text-sea transition-colors">
                {item.title}
              </div>
              <div className="text-small text-ink-disabled truncate-1">{item.meta}</div>
            </div>
            {item.secondaryAction && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  item.secondaryAction?.onClick()
                }}
                className="shrink-0 text-small text-sea hover:underline opacity-100 can-hover:opacity-0 can-hover:group-hover:opacity-100 transition-opacity"
              >
                {item.secondaryAction.label}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
