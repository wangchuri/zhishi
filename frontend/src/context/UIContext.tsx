import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react"

interface UIState {
  sidebarCollapsed: boolean
  rightPanelOpen: boolean
  mobileMenuOpen: boolean
  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void
  toggleRightPanel: () => void
  setRightPanelOpen: (v: boolean) => void
  setMobileMenuOpen: (v: boolean) => void
  toggleMobileMenu: () => void
}

const UIContext = createContext<UIState | null>(null)

export function UIProvider({ children }: { children: ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const w = typeof window !== "undefined" ? window.innerWidth : 1280
    // 平板横屏（1024–1279）默认收起为图标栏，给内容让宽度
    return w >= 1024 && w < 1280
  })
  const [rightPanelOpen, setRightPanelOpen] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth >= 1024
  )
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // 平板旋转 / 窗口缩放时联动：<lg 关闭右侧面板（避免覆盖内容），1024–1279 自动收起侧栏
  const lastWidthRef = useRef(typeof window !== "undefined" ? window.innerWidth : 1280)
  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth
      const prev = lastWidthRef.current
      lastWidthRef.current = w
      if ((prev < 1024 && w >= 1024) || (prev >= 1024 && w < 1024)) {
        setRightPanelOpen(w >= 1024)
      }
      if (w >= 1024 && w < 1280) setSidebarCollapsed(true)
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  return (
    <UIContext.Provider
      value={{
        sidebarCollapsed,
        rightPanelOpen,
        mobileMenuOpen,
        toggleSidebar: () => setSidebarCollapsed((v) => !v),
        setSidebarCollapsed,
        toggleRightPanel: () => setRightPanelOpen((v) => !v),
        setRightPanelOpen,
        setMobileMenuOpen,
        toggleMobileMenu: () => setMobileMenuOpen((v) => !v),
      }}
    >
      {children}
    </UIContext.Provider>
  )
}

export function useUI() {
  const ctx = useContext(UIContext)
  if (!ctx) throw new Error("useUI must be used within UIProvider")
  return ctx
}
