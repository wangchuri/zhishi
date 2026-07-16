import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * 知拾按钮 · 纸本设定集风格
 * variant:
 *   - secondary 细描边，悬停转 sea 色
 *   - ghost     透明，悬停 sea 色文字
 *   - danger    砖红底
 * size: sm(36) / md(40) / lg(44) / xl(48)
 * 所有圆角统一为 9999px（胶囊），与卡片 4px 圆角形成对比
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-all duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-[18px] shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-sea/30 active:scale-[0.98]",
  {
    variants: {
      variant: {
        primary: "bg-ink text-white hover:bg-sea rounded-full",
        secondary: "bg-transparent text-ink border border-line hover:border-sea hover:text-sea rounded-full",
        outline: "bg-transparent text-ink border border-line hover:border-sea hover:text-sea rounded-full",
        ghost: "text-ink-soft hover:text-sea rounded-full",
        danger: "bg-danger text-white hover:bg-danger/90 rounded-full",
      },
      size: {
        sm: "h-9 px-3 text-caption gap-1.5",
        md: "h-10 px-4 text-body",
        default: "h-10 px-4 text-body",
        lg: "h-11 px-5 text-body",
        xl: "h-12 px-6 text-body",
        icon: "h-10 w-10 rounded-full",
        "icon-sm": "h-9 w-9 rounded-full",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
