import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * 未登录几屏（连接服务器 / 登录 / 检测中 / 连不上）共用的容器。
 *
 * 移动端要点（这几条是这个组件存在的理由）：
 * 1. `viewport-fit=cover` 已开 → 必须用 `env(safe-area-inset-*)` 让开刘海与手势条，
 *    否则 logo 顶到状态栏、按钮压在 Home 指示条上；
 * 2. 用 `min-h-dvh` 而不是固定 `h-full`：软键盘弹出把可视区压矮时，页面还能滚；
 * 3. 内容用 `my-auto` 垂直居中（而不是父级 `items-center`）：内容比屏幕高时，
 *    居中会导致**顶部被裁掉且滚不到**，`my-auto` 两种情况都正常。
 */
export function AuthScaffold({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-dvh w-full overflow-y-auto bg-ink flex flex-col px-5"
      style={{
        backgroundImage: `radial-gradient(ellipse at 50% 20%, rgba(47, 138, 134, 0.15) 0%, transparent 60%)`,
        paddingTop: "max(1.5rem, env(safe-area-inset-top))",
        paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
      }}
    >
      <div className="w-full max-w-[440px] mx-auto my-auto animate-page-in">{children}</div>
    </div>
  )
}

/**
 * 未登录页的输入框：手机 48px 高 + **16px 字号**。
 *
 * 16px 不是审美选择：iOS Safari 在字号 < 16px 的输入框获得焦点时会**自动放大页面**，
 * 退出输入后也不还原（页面就一直是放大的）。桌面端维持原字号，不受影响。
 */
export const AUTH_INPUT_CLASS = cn(
  "w-full h-12 sm:h-10 px-3 rounded-[4px] border bg-paper-2 text-[16px] sm:text-body text-ink",
  "placeholder:text-ink-disabled focus:border-sea focus:ring-1 focus:ring-sea-subtle outline-none transition-all border-line",
)

/** 未登录页的主按钮：手机 48px 高，够手指点 */
export const AUTH_BUTTON_CLASS =
  "h-12 sm:h-11 rounded-full text-body font-medium transition-all duration-150 inline-flex items-center justify-center gap-2"
