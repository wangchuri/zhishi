import type { ReactNode } from "react"
import { useLocation } from "react-router-dom"
import { Sidebar } from "./Sidebar"
import { Topbar } from "./Topbar"
import { StatusRail } from "./StatusRail"
import { MobileTabBar } from "./MobileTabBar"
import { useUI } from "@/context/UIContext"
import { useOverflowDebug } from "@/lib/overflowDebug"
import { cn } from "@/lib/utils"

interface AppShellProps {
  children: ReactNode
  /** 主内容区最大宽度 px，null 表示全宽 */
  maxWidth?: number | null
  /** 是否禁用横向内边距（如全宽对话页） */
  noPadding?: boolean
}

/**
 * 三栏布局容器：Sidebar + Topbar + Main。
 * 平板端：Sidebar 变为抽屉式 overlay，点击遮罩或主内容区关闭。
 * 右侧面板由各页面自行通过 <RightPanel /> 注入（按需出现）。
 */
export function AppShell({ children, maxWidth = 1180, noPadding = false }: AppShellProps) {
  const { mobileMenuOpen, setMobileMenuOpen } = useUI()
  const { pathname, search } = useLocation()
  // 地址带 ?overflow=1 时启用「谁把页面顶宽了」探测（描红 + 控制台列表）
  useOverflowDebug(new URLSearchParams(search).has("overflow"), pathname)

  return (
    <div className="relative flex h-dvh overflow-hidden bg-paper">
      {/* 平板端：侧边栏抽屉遮罩 */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] z-30 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
      {/* 桌面端：static sidebar；平板端：fixed 抽屉 */}
      <div className={cn(
        "shrink-0 flex flex-col border-r border-line-light bg-paper transition-all duration-200 z-40 h-dvh",
        "fixed left-0 top-0 bottom-0 lg:static lg:z-auto",
        mobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
      )}>
        <Sidebar />
      </div>
      <div className="relative flex-1 flex flex-col min-w-0">
        <Topbar />
        <main
          className={cn(
            "flex-1",
            noPadding ? "overflow-hidden" : "overflow-y-auto scroll-thin p-4 md:p-5 lg:p-6 short:md:p-4 short:lg:p-5",
          )}
        >
          <div
            className={cn("mx-auto w-full animate-page-in", noPadding && "h-full")}
            style={maxWidth ? { maxWidth } : undefined}
          >
            {children}
          </div>
        </main>
        <StatusRail />
        <MobileTabBar />
      </div>
    </div>
  )
}
