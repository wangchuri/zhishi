import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ChevronRight, Loader2, ScanText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { kbApi } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { ActiveParseTask } from "@/types"

function statusText(t: ActiveParseTask) {
  if (t.status === "blocked") return "等待 OCR（需要 MinerU）"
  if (t.status === "pending") return "排队中…"
  if (t.is_scanned_pdf) return "解析中（MinerU OCR）…"
  return "解析中…"
}

/** 全局解析/上传任务横幅：跨集合列出仍在处理或等待 OCR 的资料。 */
export function ParsingTasksBanner() {
  const navigate = useNavigate()
  const [tasks, setTasks] = useState<ActiveParseTask[]>([])
  const [retrying, setRetrying] = useState(false)

  const refresh = async () => {
    try {
      const res = await kbApi.listActiveTasks()
      setTasks(res.tasks || [])
    } catch {
      setTasks([])
    }
  }

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const res = await kbApi.listActiveTasks()
        if (!cancelled) setTasks(res.tasks || [])
      } catch {
        if (!cancelled) setTasks([])
      }
    }
    void poll()
    const timer = window.setInterval(poll, 3000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const blocked = tasks.filter((t) => t.status === "blocked")

  const retry = async () => {
    setRetrying(true)
    try {
      await kbApi.retryBlockedTasks()
      await refresh()
    } finally {
      setRetrying(false)
    }
  }

  if (tasks.length === 0) return null

  return (
    <div className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 space-y-2">
      <div className="flex items-center gap-2 text-small font-medium text-ink-primary">
        <ScanText className="w-4 h-4 text-warning shrink-0" strokeWidth={2} />
        正在解析 / 上传 {tasks.length} 份资料
      </div>
      {tasks.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => navigate(`/quiz/doc/${t.id}`)}
          className="w-full flex items-start gap-3 text-left rounded-md hover:bg-warning/5 transition-colors -mx-1 px-1 py-0.5"
        >
          <Loader2
            className={cn(
              "w-4 h-4 shrink-0 mt-0.5",
              t.status === "blocked" ? "text-warning" : "animate-spin text-warning",
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="text-body text-ink-primary truncate-1">{t.name}</div>
            <div className="text-caption text-ink-secondary mt-0.5">
              {statusText(t)}
              {t.collection_name ? ` · ${t.collection_name}` : null}
              {t.parse_reason ? ` · ${t.parse_reason}` : null}
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-ink-tertiary shrink-0 mt-1" />
        </button>
      ))}
      {blocked.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-warning/20">
          <span className="text-caption text-ink-secondary flex-1 min-w-[12rem]">
            这些资料需要 OCR（MinerU）。本机未就绪时可在设置里一键安装（独立环境），装好后会自动重试。
          </span>
          <Button variant="secondary" size="sm" onClick={() => navigate("/settings")}>
            去设置安装
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void retry()} disabled={retrying}>
            {retrying ? "重试中…" : "重试"}
          </Button>
        </div>
      )}
    </div>
  )
}
