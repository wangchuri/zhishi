import { useEffect, useRef, useState } from "react"
import type { TinaMood } from "@/features/chat/tinaBursts"
import { cn } from "@/lib/utils"

type MoodParts = { l: string; r: string; m: string; prefix?: string }

const MOOD_FACE: Record<TinaMood, MoodParts> = {
  NORMAL: { l: "・", r: "・", m: "ω" },
  HAPPY: { l: "^", r: "^", m: "▿" },
  SAD: { l: "u", r: "u", m: "ε" },
  // 文案 [THINK] 不用 ?；? 仅在 usingTool（调工具）时出现
  THINK: { l: "゜", r: "゜", m: "ω" },
  HELPLESS: { l: "ー", r: "ー", m: "～" },
  MOCK: { l: "￢", r: "￢", m: "ε" },
  DISDAIN: { l: "·", r: "·", m: "д" },
}

const TOOL_FACE: MoodParts = { l: "?", r: "?", m: "ω" }

const MOUTH_TALK = ["o", "-", "ω", "o"] as const

/** 相对脸中心归一化后的跟踪幅度（对齐原 HTML mouse*15 / mouse*10，按小脸缩小） */
const EYE_RANGE_X = 8
const EYE_RANGE_Y = 5
const IDLE_RANGE_X = 6
const IDLE_RANGE_Y = 3.5

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

type Props = {
  mood: TinaMood
  speaking: boolean
  /** 正在调工具时显示 ? 眼（对齐原 HTML isUsingTool） */
  usingTool?: boolean
  className?: string
}

/**
 * Tina 本体颜文字：眨眼、口型、指针微追踪。
 * 眼/嘴用固定宽槽位，换字符时布局不塌（对齐原 HTML .eye / .mouth width）。
 * 每次挂载都从平静脸重置（父级用 key 控制重新进入）。
 */
export function TinaFacePanel({ mood, speaking, usingTool = false, className }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const eyeLRef = useRef<HTMLSpanElement>(null)
  const eyeRRef = useRef<HTMLSpanElement>(null)
  const mouthRef = useRef<HTMLSpanElement>(null)
  const earLRef = useRef<HTMLSpanElement>(null)
  const earRRef = useRef<HTMLSpanElement>(null)

  const moodRef = useRef(mood)
  const speakingRef = useRef(speaking)
  const usingToolRef = useRef(usingTool)
  const blinkingRef = useRef(false)

  const mouseX = useRef(0)
  const mouseY = useRef(0)
  const eyeX = useRef(0)
  const eyeY = useRef(0)
  const lastMove = useRef(Date.now())
  const idleX = useRef(0)
  const idleY = useRef(0)
  const talkIdx = useRef(0)

  const [visible, setVisible] = useState(false)

  const applyFace = (opts?: { keepMouth?: boolean }) => {
    const parts = usingToolRef.current
      ? TOOL_FACE
      : MOOD_FACE[moodRef.current] || MOOD_FACE.NORMAL
    if (earLRef.current) earLRef.current.textContent = parts.prefix ? `${parts.prefix},,` : "(,,"
    if (earRRef.current) earRRef.current.textContent = ",,)"
    if (!blinkingRef.current) {
      if (eyeLRef.current) {
        eyeLRef.current.textContent = parts.l
        if (usingToolRef.current) eyeLRef.current.style.transform = "translate(0, 0)"
      }
      if (eyeRRef.current) {
        eyeRRef.current.textContent = parts.r
        if (usingToolRef.current) eyeRRef.current.style.transform = "translate(0, 0)"
      }
    }
    if (!opts?.keepMouth && !speakingRef.current && mouthRef.current) {
      mouthRef.current.textContent = parts.m
      mouthRef.current.style.transform = "scale(1)"
    }
  }

  useEffect(() => {
    moodRef.current = mood
  }, [mood])

  useEffect(() => {
    speakingRef.current = speaking
  }, [speaking])

  useEffect(() => {
    usingToolRef.current = usingTool
    applyFace()
  }, [usingTool])

  useEffect(() => {
    applyFace()
  }, [mood])

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [])

  // 指针追踪 + 空闲扫视（归一化钳到 [-1,1]，像素偏移再钳一次）
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const el = rootRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      mouseX.current = clamp((e.clientX - cx) / (window.innerWidth / 2), -1, 1)
      mouseY.current = clamp((e.clientY - cy) / (window.innerHeight / 2), -1, 1)
      lastMove.current = Date.now()
    }
    window.addEventListener("mousemove", onMove, { passive: true })

    const idleTimer = window.setInterval(() => {
      if (Date.now() - lastMove.current > 3000) {
        idleX.current = (Math.random() - 0.5) * 2 * IDLE_RANGE_X
        idleY.current = (Math.random() - 0.5) * 2 * IDLE_RANGE_Y
      }
    }, 2000)

    let raf = 0
    const tick = () => {
      // 调工具时眼睛定住（对齐原 HTML !isUsingTool）
      if (!blinkingRef.current && !usingToolRef.current) {
        const tracking = Date.now() - lastMove.current < 3000
        const tx = tracking
          ? clamp(mouseX.current * EYE_RANGE_X, -EYE_RANGE_X, EYE_RANGE_X)
          : idleX.current
        const ty = tracking
          ? clamp(mouseY.current * EYE_RANGE_Y, -EYE_RANGE_Y, EYE_RANGE_Y)
          : idleY.current
        eyeX.current += (tx - eyeX.current) * 0.08
        eyeY.current += (ty - eyeY.current) * 0.08
        const t = `translate(${eyeX.current}px, ${eyeY.current}px)`
        if (eyeLRef.current) eyeLRef.current.style.transform = t
        if (eyeRRef.current) eyeRRef.current.style.transform = t
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      window.removeEventListener("mousemove", onMove)
      window.clearInterval(idleTimer)
      cancelAnimationFrame(raf)
    }
  }, [])

  // 眨眼：只换眼字符，槽位宽度固定所以整体尺寸不变
  useEffect(() => {
    let timeout = 0
    let blinkOff = 0
    const schedule = () => {
      timeout = window.setTimeout(() => {
        if (!speakingRef.current && !usingToolRef.current) {
          blinkingRef.current = true
          if (eyeLRef.current) eyeLRef.current.textContent = "-"
          if (eyeRRef.current) eyeRRef.current.textContent = "-"
          blinkOff = window.setTimeout(() => {
            blinkingRef.current = false
            applyFace({ keepMouth: true })
          }, 150)
        }
        schedule()
      }, 3000 + Math.random() * 5000)
    }
    schedule()
    return () => {
      window.clearTimeout(timeout)
      window.clearTimeout(blinkOff)
    }
  }, [])

  // 说话口型 / 静止微动
  useEffect(() => {
    const id = window.setInterval(() => {
      const mouth = mouthRef.current
      if (!mouth) return
      if (usingToolRef.current) {
        mouth.textContent = TOOL_FACE.m
        mouth.style.transform = "scale(1)"
        return
      }
      if (speakingRef.current) {
        talkIdx.current = (talkIdx.current + 1) % MOUTH_TALK.length
        mouth.textContent = MOUTH_TALK[talkIdx.current]
        mouth.style.transform = `scale(${1 + Math.random() * 0.18})`
      } else {
        const parts = MOOD_FACE[moodRef.current] || MOOD_FACE.NORMAL
        mouth.textContent = parts.m
        mouth.style.transform = `scale(${1 + Math.sin(Date.now() / 500) * 0.03})`
      }
    }, 110)
    return () => window.clearInterval(id)
  }, [])

  const slot =
    "inline-flex items-center justify-center shrink-0 text-center will-change-transform"
  const eyeSlot = cn(slot, "w-[1.15em]")
  const mouthSlot = cn(slot, "w-[1.25em] transition-transform duration-75")

  return (
    <div
      ref={rootRef}
      className={cn(
        "overflow-hidden transition-all duration-500 ease-out",
        visible ? "max-h-36 opacity-100" : "max-h-0 opacity-0",
        className,
      )}
      aria-hidden
    >
      <div
        className={cn(
          "relative flex flex-col items-center justify-center py-5 px-4",
          "rounded-b-[20px] border-b border-x border-line/80",
          "bg-gradient-to-b from-paper-2/90 to-surface/60",
          "shadow-[0_8px_24px_-12px_rgba(40,50,70,0.18)]",
        )}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent, transparent 3px, currentColor 3px, currentColor 4px)",
          }}
        />
        <div
          className="relative flex items-center justify-center select-none font-mono tracking-tight text-ink"
          style={{
            fontSize: "clamp(1.75rem, 4.5vw, 2.75rem)",
            lineHeight: 1,
            gap: "0.12em",
            height: "1.2em",
          }}
        >
          <span
            ref={earLRef}
            className="inline-block whitespace-nowrap shrink-0 transition-transform duration-200"
          >
            (,,
          </span>
          <span ref={eyeLRef} className={eyeSlot}>
            ・
          </span>
          <span ref={mouthRef} className={mouthSlot}>
            ω
          </span>
          <span ref={eyeRRef} className={eyeSlot}>
            ・
          </span>
          <span
            ref={earRRef}
            className="inline-block whitespace-nowrap shrink-0 transition-transform duration-200"
          >
            ,,)
          </span>
        </div>
        <p className="mt-2 text-caption text-ink-tertiary tracking-wide">Tina</p>
      </div>
    </div>
  )
}
