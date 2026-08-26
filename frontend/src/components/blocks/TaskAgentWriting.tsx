import { useEffect, useState } from "react"
import { MistRings, SealMark } from "@/components/decor/PaperMotifs"
import { cn } from "@/lib/utils"

const LINES = [
  "翻了翻目标…",
  "看看哪本书还缺练习…",
  "挑几道值得刷的题…",
  "要不要再学一章？",
  "便签写好了，马上贴上…",
]

/** Tina 派任务时的纸本动效：便签落纸 + 文案轮换 */
export function TaskAgentWriting({
  className,
  compact,
  title = "Tina 正在安排今天",
}: {
  className?: string
  compact?: boolean
  title?: string
}) {
  const [line, setLine] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => {
      setLine((i) => (i + 1) % LINES.length)
    }, 1800)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-sea/25 bg-paper text-center",
        "shadow-[0_4px_20px_-2px_rgba(20,33,43,0.05)]",
        compact ? "px-3.5 py-5" : "px-5 py-10",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="paper-grain pointer-events-none absolute inset-0 opacity-50" />
      <MistRings
        className={cn(
          "animate-mist pointer-events-none absolute text-sea opacity-40",
          compact ? "-right-6 -top-8 w-28 h-28" : "-right-10 -top-12 w-44 h-44",
        )}
      />

      <div className="relative mx-auto mb-4 flex h-20 w-40 items-end justify-center">
        <div className="task-agent-slip task-agent-slip-a absolute left-4 bottom-1 h-14 w-24 rounded-md border border-line bg-paper-2" />
        <div className="task-agent-slip task-agent-slip-b absolute left-10 bottom-2 h-14 w-24 rounded-md border border-line bg-paper" />
        <div className="task-agent-slip task-agent-slip-c absolute left-16 bottom-3 h-14 w-24 rounded-md border border-sea/30 bg-paper shadow-sm">
          <div className="paper-ruled h-full px-2 pt-2 opacity-70">
            <span className="task-agent-ink-line block h-1 w-14 rounded-full bg-sea/35" />
            <span className="task-agent-ink-line mt-1.5 block h-1 w-10 rounded-full bg-sea/25" />
          </div>
        </div>
        <SealMark className="task-agent-stamp absolute -right-1 bottom-0 h-9 w-9 text-sea" label="派" />
        <span className="task-agent-pen pointer-events-none absolute right-2 top-0 h-8 w-1.5 rounded-full bg-ink/70" />
      </div>

      <p className={cn("relative font-display text-ink", compact ? "text-body" : "text-[1.15rem]")}>
        {title}
      </p>
      <p
        key={line}
        className="task-agent-line relative mt-1.5 text-caption text-ink-soft"
      >
        {LINES[line]}
      </p>
    </div>
  )
}
