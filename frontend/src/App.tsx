import { BrowserRouter } from "react-router-dom"
import { useEffect } from "react"
import { toast } from "sonner"
import { UIProvider } from "@/context/UIContext"
import { AuthProvider } from "@/context/AuthContext"
import { TinaCrisisProvider } from "@/context/TinaCrisisContext"
import { AppRoutes } from "@/routes"
import { Toaster } from "@/components/ui/sonner"
import { FullscreenSuggestion } from "@/components/blocks/FullscreenSuggestion"
import { TinaEscapeOverlay } from "@/components/layout/TinaEscapeOverlay"
import { TinaCrisisLock } from "@/components/layout/TinaCrisisLock"
import { GlobalTipCapture } from "@/components/layout/GlobalTipCapture"
import { useActiveTime } from "@/hooks/useActiveTime"
import { achievementsApi, tasksApi } from "@/lib/api"
import { noticeTodayTasks } from "@/lib/taskNotify"

function TaskWatcher() {
  useEffect(() => {
    let cancelled = false
    let timer = 0
    const tick = () => {
      tasksApi
        .getToday()
        .then((res) => {
          if (cancelled) return
          noticeTodayTasks(res)
          const wait = res.refill_pending ? 2500 : 180_000
          timer = window.setTimeout(tick, wait)
        })
        .catch(() => {
          if (!cancelled) timer = window.setTimeout(tick, 180_000)
        })
    }
    tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])
  return null
}

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
          <TinaCrisisProvider>
            <TinaCrisisLock />
            <AppRoutes />
            <GlobalTipCapture />
            <AchievementWatcher />
            <TaskWatcher />
            <FullscreenSuggestion />
            <Toaster richColors closeButton />
            <TinaEscapeOverlay />
          </TinaCrisisProvider>
        </BrowserRouter>
      </AuthProvider>
    </UIProvider>
  )
}

export default App
