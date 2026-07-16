import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * 知拾 Chip 标签 · 对应设计第 10.4 节
 * 用于筛选、模式切换、标签展示。
 */
const chipVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full font-medium transition-all duration-160 cursor-pointer select-none whitespace-nowrap [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: "bg-paper-2 text-ink-soft border border-line-light hover:bg-paper-deep",
        selected: "bg-sea-subtle text-sea border border-sea/30",
        filter: "bg-paper-2 text-ink-soft border border-line-light hover:border-sea/40 hover:text-sea",
      },
      size: {
        sm: "h-7 px-3 text-small",
        md: "h-8 px-3.5 text-caption",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  }
)

function Chip({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof chipVariants>) {
  return (
    <button
      type="button"
      data-slot="chip"
      className={cn(chipVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Chip, chipVariants }
