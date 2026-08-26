import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowLeft, Play, BookOpen } from "lucide-react"
import { AppShell } from "@/components/layout/AppShell"
import { PageHeader } from "@/components/blocks/PageHeader"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { quizApi } from "@/lib/api"
import type { QuizSession } from "@/types"

/** 未答完的刷题会话列表，可继续上次进度 */
export function QuizOngoingPage() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<QuizSession[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    quizApi
      .listActiveSessions()
      .then((res) => {
        if (cancelled) return
        setSessions((res.sessions || []) as QuizSession[])
      })
      .catch(() => {
        if (!cancelled) setSessions([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <AppShell maxWidth={720}>
      <PageHeader
        title="继续刷题"
        subtitle="这里是还没刷完的会话，点进去接着上次的进度"
      >
        <Button variant="secondary" size="md" onClick={() => navigate("/quiz")}>
          <ArrowLeft className="w-4 h-4" />
          返回资料
        </Button>
      </PageHeader>

      {loading ? (
        <p className="text-body text-ink-soft py-10 text-center">正在查找未完成的练习…</p>
      ) : sessions.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="没有进行中的刷题"
          description="从任务或资料里开始练习后，中途离开会在这里出现。"
          primaryAction={{ label: "去资料", onClick: () => navigate("/quiz") }}
        />
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => {
            const total = s.total_questions || 0
            const answered = s.answered_count || 0
            const name = s.document_name
            return (
              <div
                key={s.id}
                className="flex items-center gap-3 rounded-2xl border border-line bg-paper px-4 py-3.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-body font-medium text-ink truncate">
                    {s.title || name || "刷题会话"}
                  </p>
                  <p className="text-caption text-ink-soft mt-0.5">
                    {name && s.title ? `${name} · ` : ""}
                    已答 {answered}/{total} 题
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => navigate(`/quiz/session?session_id=${encodeURIComponent(s.id)}`)}
                >
                  <Play className="w-3.5 h-3.5" strokeWidth={2} />
                  继续
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </AppShell>
  )
}
