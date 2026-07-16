import { createContext, useContext, useState, type ReactNode } from "react"

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

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
