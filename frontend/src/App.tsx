import { BrowserRouter } from "react-router-dom"
import { useEffect } from "react"
import { toast } from "sonner"
import { UIProvider } from "@/context/UIContext"
import { AuthProvider } from "@/context/AuthContext"
import { AppRoutes } from "@/routes"
import { Toaster } from "@/components/ui/sonner"
import { FullscreenSuggestion } from "@/components/blocks/FullscreenSuggestion"
import { useActiveTime } from "@/hooks/useActiveTime"
import { achievementsApi } from "@/lib/api"

/** 登录后检查一次新解锁成就，弹出提示（惰性判定由后端完成）。 */
function AchievementWatcher() {
  useEffect(() => {
    let cancelled = false
    achievementsApi
      .list()
      .then((res) => {
        if (cancelled) return
        const fresh = (res.achievements || []).filter((a) =>
          res.newly_unlocked.includes(a.id)
        )
        fresh.forEach((a) => toast.success(`解锁成就：${a.name}`, { icon: "🏆" }))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return null
}

function App() {
  useActiveTime()

  return (
    <UIProvider>
      <AuthProvider>
        <BrowserRouter
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true,
          }}
        >
          <AppRoutes />
          <AchievementWatcher />
          <FullscreenSuggestion />
          <Toaster richColors closeButton />
        </BrowserRouter>
      </AuthProvider>
    </UIProvider>
  )
}

export default App
