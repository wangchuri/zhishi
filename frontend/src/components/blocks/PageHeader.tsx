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
    <div
      className={cn(
        // 手机：标题一行、操作另起一行且允许换行 —— 否则操作区 shrink-0 会把页面顶出横向滚动条
        "flex flex-col gap-2 mb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-page-title text-ink-primary">{title}</h1>
        {subtitle && <p className="text-caption text-ink-secondary mt-0.5">{subtitle}</p>}
      </div>
      {children && (
        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:shrink-0">
          {children}
        </div>
      )}
    </div>
  )
}
