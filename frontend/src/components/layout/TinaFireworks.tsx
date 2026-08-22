import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"

const MAX_PARTICLES = 520
const MOVE_GAP_MS = 55

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  decay: number
  size: number
  color: string
  spark: boolean
}

export type Pointer = { x: number; y: number }

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function palette() {
  return [
    cssVar("--danger", "#A0352B"),
    cssVar("--ember", "#C45C26"),
    cssVar("--sea-bright", "#2F8A86"),
    cssVar("--paper", "#F3EFE6"),
    cssVar("--warning", "#C45C26"),
  ]
}

function burst(particles: Particle[], cx: number, cy: number, count: number) {
  const colors = palette()
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4
    const speed = 1.4 + Math.random() * 4.2
    particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.4,
      life: 1,
      decay: 0.014 + Math.random() * 0.02,
      size: 1.2 + Math.random() * 2.6,
      color: colors[i % colors.length],
      spark: Math.random() > 0.5,
    })
  }
  if (particles.length > MAX_PARTICLES) {
    particles.splice(0, particles.length - MAX_PARTICLES)
  }
}

interface TinaFireworksProps {
  pointer: Pointer | null
  playing: boolean
  poke: number
}

export function TinaFireworks({ pointer, playing, poke }: TinaFireworksProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const rafRef = useRef(0)
  const lastMoveBurst = useRef(0)
  const playingRef = useRef(playing)
  const pointerRef = useRef(pointer)
  const startLoopRef = useRef<() => void>(() => {})
  playingRef.current = playing
  pointerRef.current = pointer

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduce) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    fit()
    window.addEventListener("resize", fit)

    const tick = () => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
      const next: Particle[] = []
      for (const p of particlesRef.current) {
        p.x += p.vx
        p.y += p.vy
        p.vy += 0.05
        p.vx *= 0.985
        p.life -= p.decay
        if (p.life <= 0) continue
        ctx.globalAlpha = Math.max(0, p.life)
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * (0.4 + p.life * 0.6), 0, Math.PI * 2)
        ctx.fill()
        if (p.spark) {
          ctx.strokeStyle = p.color
          ctx.lineWidth = 0.8
          ctx.beginPath()
          ctx.moveTo(p.x, p.y)
          ctx.lineTo(p.x - p.vx * 1.8, p.y - p.vy * 1.8)
          ctx.stroke()
        }
        next.push(p)
      }
      particlesRef.current = next
      ctx.globalAlpha = 1
      if (next.length > 0 || playingRef.current) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        rafRef.current = 0
      }
    }

    startLoopRef.current = () => {
      if (!rafRef.current) rafRef.current = requestAnimationFrame(tick)
    }

    return () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
      window.removeEventListener("resize", fit)
    }
  }, [])

  useEffect(() => {
    if (!poke) return
    const p = pointerRef.current
    if (!p) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    lastMoveBurst.current = performance.now()
    burst(particlesRef.current, p.x, p.y, 24)
    startLoopRef.current()
  }, [poke])

  useEffect(() => {
    if (!playing || !pointer || poke === 0) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const now = performance.now()
    if (now - lastMoveBurst.current < MOVE_GAP_MS) return
    lastMoveBurst.current = now
    burst(particlesRef.current, pointer.x, pointer.y, 16)
    startLoopRef.current()
  }, [pointer, playing, poke])

  if (typeof document === "undefined") return null

  return createPortal(
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-[80] h-screen w-screen"
      aria-hidden
    />,
    document.body,
  )
}
