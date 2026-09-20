import * as React from "react"
import { cn } from "@/lib/utils"

/** 模块标题区 · 模块标题 + 可选副标题 + 可选右侧操作 */
interface SectionHeaderProps {
  title: string
  subtitle?: string
  children?: React.ReactNode
  className?: string
  /** 传入后标题可点击（如切换目录 / 思维导图） */
  onTitleClick?: () => void
  /** 可点击标题时右侧的提示文案 */
  titleHint?: string
}

export function SectionHeader({
  title,
  subtitle,
  children,
  className,
  onTitleClick,
  titleHint,
}: SectionHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between gap-4 mb-4", className)}>
      <div className="min-w-0">
        {onTitleClick ? (
          <button
            type="button"
            onClick={onTitleClick}
            className="group inline-flex items-baseline gap-2 text-left"
            title={titleHint || "点击切换"}
          >
            <h2 className="font-display text-display-m text-ink leading-tight group-hover:text-sea transition-colors">
              {title}
            </h2>
            {titleHint ? (
              <span className="text-caption text-sea font-medium whitespace-nowrap">
                {titleHint}
              </span>
            ) : null}
          </button>
        ) : (
          <h2 className="font-display text-display-m text-ink leading-tight">{title}</h2>
        )}
        {subtitle && <p className="text-caption text-ink-disabled mt-0.5">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
    </div>
  )
}
