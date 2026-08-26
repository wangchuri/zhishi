import { cn } from "@/lib/utils"
import type { HeatmapDay } from "@/types"

function cellClass(seconds: number): string {
  if (seconds <= 0) return "bg-paper-2 border border-line-light"
  if (seconds < 300) return "bg-sea/30"
  if (seconds < 900) return "bg-sea/50"
  if (seconds < 1800) return "bg-sea/70"
  return "bg-sea"
}

function cellTip(d: HeatmapDay): string {
  const minutes = Math.max(1, Math.round(d.seconds / 60))
  return `${d.date} · 学习 ${minutes} 分钟`
}

/** GitHub 风格活跃热力图：每列 7 天（周），色深表示当日学习时长。 */
export function Heatmap({
  data,
  className,
}: {
  data: HeatmapDay[]
  className?: string
}) {
  if (!data.length) return null

  const weeks: HeatmapDay[][] = []
  for (let i = 0; i < data.length; i += 7) weeks.push(data.slice(i, i + 7))

  return (
    <div className={cn("flex gap-[3px] overflow-x-auto scroll-thin pb-1", className)}>
      {weeks.map((week, wi) => (
        <div key={wi} className="flex flex-col gap-[3px]">
          {week.map((d) => (
            <div
              key={d.date}
              title={cellTip(d)}
              className={cn(
                "w-[11px] h-[11px] rounded-[2px] shrink-0",
                cellClass(d.seconds)
              )}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
