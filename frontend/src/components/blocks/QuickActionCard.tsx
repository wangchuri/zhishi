import type { LucideIcon } from "lucide-react"
import { ChevronRight } from "lucide-react"
import { MistRings } from "@/components/decor/PaperMotifs"
import { cn } from "@/lib/utils"

/** 快捷操作卡片 · 首页横向卡片 */
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
        "group relative text-left overflow-hidden card-paper-interactive p-4",
        className,
      )}
    >
      <MistRings className="pointer-events-none absolute -right-6 -bottom-8 w-24 h-24 text-sea opacity-0 group-hover:opacity-40 transition-opacity duration-300" />
      <div className="relative flex items-center justify-between mb-3">
        <div className="w-10 h-10 rounded-full bg-sea-subtle text-sea flex items-center justify-center group-hover:bg-sea group-hover:text-paper transition-colors">
          <Icon className="w-5 h-5" strokeWidth={2} />
        </div>
        <ChevronRight className="w-4 h-4 text-ink-disabled group-hover:text-sea group-hover:translate-x-0.5 transition-all" strokeWidth={2} />
      </div>
      <div className="relative font-display text-display-m text-ink mb-1">{title}</div>
      <div className="relative text-caption text-ink-disabled leading-relaxed truncate-2">{description}</div>
    </button>
  )
}
