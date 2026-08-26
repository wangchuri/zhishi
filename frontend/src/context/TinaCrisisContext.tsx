import { createContext, useContext, useMemo, useState, type ReactNode } from "react"

interface TinaCrisisState {
  active: boolean
  escaping: boolean
  deleted: Set<string>
  enableCrisis: () => void
  hideControl: (path: string) => void
  startEscape: () => void
}

const TinaCrisisContext = createContext<TinaCrisisState | null>(null)

const STALE_DELETED_KEY = "zhishi_tina_crisis_deleted"

try {
  localStorage.removeItem(STALE_DELETED_KEY)
} catch {
  /* ignore */
}

export function TinaCrisisProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false)
  const [escaping, setEscaping] = useState(false)
  const [deletedList, setDeletedList] = useState<string[]>([])

  const value = useMemo<TinaCrisisState>(() => ({
    active,
    escaping,
    deleted: new Set(deletedList),
    enableCrisis: () => setActive(true),
    hideControl: (path: string) => {
      setDeletedList((prev) => {
        if (prev.includes(path)) return prev
        return [...prev, path]
      })
    },
    startEscape: () => {
      setActive(true)
      setEscaping(true)
    },
  }), [active, escaping, deletedList])

  return (
    <TinaCrisisContext.Provider value={value}>
      {children}
    </TinaCrisisContext.Provider>
  )
}

export function useTinaCrisis() {
  const ctx = useContext(TinaCrisisContext)
  if (!ctx) throw new Error("useTinaCrisis must be used within TinaCrisisProvider")
  return ctx
}
