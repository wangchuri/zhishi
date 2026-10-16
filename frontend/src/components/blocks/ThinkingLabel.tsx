import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

/**
 * 思考标签：正在想显示「思考中」，想完了显示「思考过程」；
 * 后面的点在流式思考时 . → .. → ... 循环（想完就不动）。
 * 传 prefix 可覆盖文案。
 */
export function ThinkingLabel({
  className,
  prefix,
  active = false,
}: {
  className?: string
  prefix?: string
  active?: boolean
}) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setTick((n) => n + 1), 420)
    return () => window.clearInterval(id)
  }, [active])

  // 不动的状态下不显示点；动的时候 1→2→3 循环（用 tick 推导，避免在 effect 里 setState）
  const dots = active ? (tick % 3) + 1 : 0

  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {prefix ?? (active ? "思考中" : "思考过程")}
      {active ? (
        <span className="inline-block w-[1.5em] text-left" aria-hidden>
          {".".repeat(dots)}
        </span>
      ) : null}
    </span>
  )
}

/**
 * 取「最近的一小段」思考内容（保留尾部 —— 新想出来的字在最后）。
 * 用于折叠状态下在标签下一行显示"它此刻在想什么"。
 */
function latestThought(text: string, max = 46): string {
  const flat = (text || "").replace(/\s+/g, " ").trim()
  if (!flat) return ""
  return flat.length <= max ? flat : `…${flat.slice(-max)}`
}

/** 思考中时，显示在标签下一行的实时摘录。 */
export function ThinkingPeek({ content, className }: { content: string; className?: string }) {
  const peek = latestThought(content)
  if (!peek) return null
  return (
    <div
      className={cn(
        "text-caption text-ink-disabled pl-4 leading-snug truncate-1 opacity-80",
        className,
      )}
      title={peek}
    >
      {peek}
    </div>
  )
}
