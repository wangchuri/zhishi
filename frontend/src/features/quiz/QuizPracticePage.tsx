import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowRight } from "lucide-react"
import { AppShell } from "@/components/layout/AppShell"
import { PageHeader } from "@/components/blocks/PageHeader"
import { Button } from "@/components/ui/button"
import { quizApi } from "@/lib/api"
import { QuizSessionPicker } from "@/features/quiz/QuizSessionPicker"
import type { QuizSessionSummary } from "@/types"

/**
 * 独立刷题页：顶部最显眼的是「继续最近刷题」，下面是历史刷题会话。
 * 已完成的会话折叠起来，默认收起，避免把进行中的会话挤下去。
 */
export function QuizPracticePage() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<QuizSessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    quizApi
      .listSessionHistory(40)
      .then((res) => {
        if (cancelled) return
        setSessions(res.sessions || [])
        setError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setSessions([])
        setError(err instanceof Error ? err.message : "刷题记录加载失败")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const retry = () => {
    setLoading(true)
    setReloadKey((k) => k + 1)
  }

  return (
    <AppShell maxWidth={720}>
      <PageHeader title="刷题" subtitle="接着上次的进度继续，或回看历史会话">
        <Button variant="secondary" size="md" onClick={() => navigate("/quiz")}>
          去资料
          <ArrowRight className="w-4 h-4" />
        </Button>
      </PageHeader>

      <QuizSessionPicker
        sessions={sessions}
        loading={loading}
        error={error}
        onRetry={retry}
        onPick={(session) =>
          navigate(`/quiz/session?session_id=${encodeURIComponent(session.id)}`)
        }
        onOpenLibrary={() => navigate("/quiz")}
      />
    </AppShell>
  )
}
