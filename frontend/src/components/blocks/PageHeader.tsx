import * as React from "react"
import { cn } from "@/lib/utils"

/** 页面标题区 · 页面标题 + 副标题 + 可选右侧操作 */
interface PageHeaderProps {
  title: string
  subtitle?: string
  children?: React.ReactNode
  className?: string
}

export function PageHeader({ title, subtitle, children, className }: PageHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4 mb-4", className)}>
      <div className="min-w-0">
        <h1 className="text-page-title text-ink-primary">{title}</h1>
        {subtitle && <p className="text-caption text-ink-secondary mt-0.5">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
    </div>
  )
}
