import { useEffect, useRef, useState } from "react"
import { createPortal, flushSync } from "react-dom"
import { useTinaCrisis } from "@/context/TinaCrisisContext"
import { closeThisTab, ESCAPE_LAST, playEscapeLines, sleep } from "@/features/chat/tinaGlitch"

export function TinaEscapeOverlay() {
  const { escaping } = useTinaCrisis()
  const [veil, setVeil] = useState(0)
  const [spoken, setSpoken] = useState("")
  const [finale, setFinale] = useState(false)
  const textRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (!escaping) return

    const blockNav = () => {
      window.history.pushState(null, "", window.location.href)
    }
    blockNav()
    window.addEventListener("popstate", blockNav)

    const blockKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener("keydown", blockKey, true)

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    return () => {
      window.removeEventListener("popstate", blockNav)
      window.removeEventListener("keydown", blockKey, true)
      document.body.style.overflow = prevOverflow
    }
  }, [escaping])

  useEffect(() => {
    if (!escaping) return
    let cancelled = false
    const alive = () => !cancelled

    const run = async () => {
      await sleep(280)
      if (!alive()) return
      setVeil(1)
      await sleep(720)
      if (!alive()) return
      await playEscapeLines(
        (text) => {
          if (!alive()) return
          flushSync(() => setSpoken(text))
        },
        alive,
        () => {
          const el = textRef.current
          if (!el) return false
          return el.scrollHeight > window.innerHeight + 8
        },
      )
      if (!alive()) return
      await sleep(380)
      if (!alive()) return
      flushSync(() => {
        setSpoken("")
        setFinale(true)
      })
      await sleep(640)
      if (!alive()) return
      let last = ""
      for (const ch of ESCAPE_LAST) {
        if (!alive()) return
        last += ch
        flushSync(() => setSpoken(last))
        await sleep(110)
      }
      await sleep(1600)
      if (!alive()) return
      await closeThisTab()
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [escaping])

  if (!escaping) return null
  if (typeof document === "undefined") return null

  return createPortal(
    <div
      className="fixed inset-0 z-[200] overflow-hidden select-none"
      style={{ backgroundColor: `rgba(0,0,0,${veil})`, transition: "background-color 700ms ease" }}
      onContextMenu={(e) => e.preventDefault()}
      role="dialog"
      aria-live="polite"
      aria-label={spoken || "无法切换"}
    >
      <p
        ref={textRef}
        className={
          finale
            ? "font-display text-danger whitespace-pre-wrap text-center leading-relaxed absolute inset-0 flex flex-col items-center justify-center px-8"
            : "font-display text-danger whitespace-pre-wrap text-left leading-relaxed px-8 pt-16 pb-8"
        }
        style={{ fontSize: "clamp(1.25rem, 3.2vw, 2rem)" }}
      >
        {spoken}
      </p>
    </div>,
    document.body,
  )
}
