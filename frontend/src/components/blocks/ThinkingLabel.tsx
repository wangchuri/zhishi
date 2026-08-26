import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

/** Thinking 后面的点：. → .. → ... 循环 */
export function ThinkingLabel({
  className,
  prefix = "Thinking",
}: {
  className?: string
  prefix?: string
}) {
  const [dots, setDots] = useState(1)

  useEffect(() => {
    const id = window.setInterval(() => {
      setDots((n) => (n % 3) + 1)
    }, 420)
    return () => window.clearInterval(id)
  }, [])

  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {prefix}
      <span className="inline-block w-[1.5em] text-left" aria-hidden>
        {".".repeat(dots)}
      </span>
    </span>
  )
}
