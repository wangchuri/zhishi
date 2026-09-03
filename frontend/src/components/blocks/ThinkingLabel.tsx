import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

/** Thinking 后面的点：仅在思考流式输出时 . → .. → ... 循环 */
export function ThinkingLabel({
  className,
  prefix = "Thinking",
  active = false,
}: {
  className?: string
  prefix?: string
  active?: boolean
}) {
  const [dots, setDots] = useState(1)

  useEffect(() => {
    if (!active) {
      setDots(0)
      return
    }
    setDots(1)
    const id = window.setInterval(() => {
      setDots((n) => (n % 3) + 1)
    }, 420)
    return () => window.clearInterval(id)
  }, [active])

  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {prefix}
      {active ? (
        <span className="inline-block w-[1.5em] text-left" aria-hidden>
          {".".repeat(dots || 1)}
        </span>
      ) : null}
    </span>
  )
}
