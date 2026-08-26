import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"

interface UIState {
  sidebarCollapsed: boolean
  rightPanelOpen: boolean
  mobileMenuOpen: boolean
  hasCustomRightPanel: boolean
  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void
  toggleRightPanel: () => void
  setRightPanelOpen: (v: boolean) => void
  setMobileMenuOpen: (v: boolean) => void
  toggleMobileMenu: () => void
  registerRightPanel: () => () => void
}

const UIContext = createContext<UIState | null>(null)

export function UIProvider({ children }: { children: ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const w = typeof window !== "undefined" ? window.innerWidth : 1280
    // 平板横屏（1024–1279）默认收起为图标栏，给内容让宽度
    return w >= 1024 && w < 1280
  })
  const [rightPanelOpen, setRightPanelOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [hasCustomRightPanel, setHasCustomRightPanel] = useState(false)
  const customCountRef = useRef(0)

  const registerRightPanel = useCallback(() => {
    customCountRef.current += 1
    setHasCustomRightPanel(true)
    return () => {
      customCountRef.current = Math.max(0, customCountRef.current - 1)
      setHasCustomRightPanel(customCountRef.current > 0)
    }
  }, [])

  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth
      if (w >= 1024 && w < 1280) setSidebarCollapsed(true)
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  useEffect(() => {
    if (!rightPanelOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRightPanelOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [rightPanelOpen])

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
        hasCustomRightPanel,
        registerRightPanel,
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
