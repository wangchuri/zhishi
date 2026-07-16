import type { LucideIcon } from "lucide-react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

/** 快捷操作卡片 · 首页横向 4 卡片 */
interface QuickActionCardProps {
  icon: LucideIcon
  title: string
  description: string
  onClick?: () => void
  className?: string
}

export function QuickActionCard({ icon: Icon, title, description, onClick, className }: QuickActionCardProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group text-left card-paper-interactive p-4",
        className
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="w-10 h-10 rounded-[4px] bg-sea-subtle text-sea flex items-center justify-center group-hover:bg-sea group-hover:text-paper transition-colors">
          <Icon className="w-5 h-5" strokeWidth={2} />
        </div>
        <ChevronRight className="w-4 h-4 text-ink-disabled group-hover:text-sea group-hover:translate-x-0.5 transition-all" strokeWidth={2} />
      </div>
      <div className="font-display text-display-m text-ink mb-1">{title}</div>
      <div className="text-caption text-ink-disabled leading-relaxed truncate-2">{description}</div>
    </button>
  )
}
