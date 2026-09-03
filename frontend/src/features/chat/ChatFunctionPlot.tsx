import { useMemo, useRef, useState, type MouseEvent } from "react"
import { compileMathExpr } from "@/lib/mathExpr"
import { cn } from "@/lib/utils"

export type ChatPlotPayload = {
  id: string
  title?: string | null
  expressions: string[]
  x_min: number
  x_max: number
}

const COLORS = ["#1F5C5A", "#C45C26", "#2A3A47"]
const SAMPLES = 480

function niceNum(span: number, round: boolean): number {
  const exp = Math.floor(Math.log10(span))
  const f = span / 10 ** exp
  let nf: number
  if (round) {
    if (f < 1.5) nf = 1
    else if (f < 3) nf = 2
    else if (f < 7) nf = 5
    else nf = 10
  } else {
    if (f <= 1) nf = 1
    else if (f <= 2) nf = 2
    else if (f <= 5) nf = 5
    else nf = 10
  }
  return nf * 10 ** exp
}

function ticks(min: number, max: number, count: number): number[] {
  const span = niceNum(max - min, false)
  const step = niceNum(span / (count - 1), true)
  const start = Math.ceil(min / step) * step
  const out: number[] = []
  for (let v = start; v <= max + step * 0.5; v += step) {
    out.push(Number(v.toPrecision(12)))
    if (out.length > 16) break
  }
  return out
}

function fmtTick(n: number): string {
  if (Math.abs(n) < 1e-9) return "0"
  const a = Math.abs(n)
  if (a >= 1000 || (a > 0 && a < 0.01)) return n.toExponential(1).replace(/\.0+e/, "e")
  return String(Number(n.toPrecision(4)))
}

type Series = { expr: string; color: string; error?: string; points: Array<{ x: number; y: number } | null> }

function sample(expr: string, xMin: number, xMax: number, color: string): Series {
  const compiled = compileMathExpr(expr)
  if (!compiled.ok) return { expr, color, error: compiled.error, points: [] }
  const dx = (xMax - xMin) / SAMPLES
  const ys: number[] = []
  const xs: number[] = []
  for (let i = 0; i <= SAMPLES; i++) {
    const x = xMin + dx * i
    xs.push(x)
    ys.push(compiled.eval(x))
  }
  const finite = ys.filter((y) => Number.isFinite(y))
  const ySpan =
    finite.length > 1
      ? Math.max(...finite) - Math.min(...finite)
      : 1
  const jump = Math.max(20 * (ySpan || 1), 50)
  const points: Series["points"] = []
  for (let i = 0; i <= SAMPLES; i++) {
    const y = ys[i]
    if (!Number.isFinite(y)) {
      points.push(null)
      continue
    }
    const prev = points[points.length - 1]
    if (prev && Math.abs(y - prev.y) > jump) points.push(null)
    points.push({ x: xs[i], y })
  }
  return { expr, color, points }
}

export function ChatFunctionPlot({
  plot,
  className,
}: {
  plot: ChatPlotPayload
  className?: string
}) {
  const series = useMemo(() => {
    const xMin = Number(plot.x_min)
    const xMax = Number(plot.x_max)
    const lo = Number.isFinite(xMin) ? xMin : -10
    const hi = Number.isFinite(xMax) ? xMax : 10
    const left = lo === hi ? lo - 1 : Math.min(lo, hi)
    const right = lo === hi ? hi + 1 : Math.max(lo, hi)
    return (plot.expressions || []).slice(0, 3).map((expr, i) => sample(expr, left, right, COLORS[i % COLORS.length]))
  }, [plot])

  const box = useMemo(() => {
    const xs: number[] = []
    const ys: number[] = []
    for (const s of series) {
      for (const p of s.points) {
        if (!p) continue
        xs.push(p.x)
        ys.push(p.y)
      }
    }
    const xMin = xs.length ? Math.min(...xs) : plot.x_min
    const xMax = xs.length ? Math.max(...xs) : plot.x_max
    const finite = [...ys].filter((y) => Number.isFinite(y)).sort((a, b) => a - b)
    let yMin = -1
    let yMax = 1
    if (finite.length) {
      const lo = finite[Math.floor((finite.length - 1) * 0.02)]
      const hi = finite[Math.floor((finite.length - 1) * 0.98)]
      yMin = lo
      yMax = hi
    }
    if (yMin === yMax) {
      yMin -= 1
      yMax += 1
    }
    const pad = (yMax - yMin) * 0.08
    return { xMin, xMax, yMin: yMin - pad, yMax: yMax + pad }
  }, [series, plot.x_min, plot.x_max])

  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<{ x: number; ys: Array<{ expr: string; color: string; y: number }> } | null>(null)

  const W = 640
  const H = 420
  const padL = 44
  const padR = 16
  const padT = 16
  const padB = 32
  const iw = W - padL - padR
  const ih = H - padT - padB
  const sx = (x: number) => padL + ((x - box.xMin) / (box.xMax - box.xMin || 1)) * iw
  const sy = (y: number) => padT + ((box.yMax - y) / (box.yMax - box.yMin || 1)) * ih

  const xTicks = ticks(box.xMin, box.xMax, 7)
  const yTicks = ticks(box.yMin, box.yMax, 6)

  const polylines = (s: Series) => {
    const segs: string[] = []
    let cur: string[] = []
    const flush = () => {
      if (cur.length >= 2) segs.push(cur.join(" "))
      cur = []
    }
    for (const p of s.points) {
      if (!p) {
        flush()
        continue
      }
      cur.push(`${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`)
    }
    flush()
    return segs
  }

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const el = svgRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const x = box.xMin + ((px - padL) / iw) * (box.xMax - box.xMin)
    if (x < box.xMin || x > box.xMax) {
      setHover(null)
      return
    }
    const ys: Array<{ expr: string; color: string; y: number }> = []
    for (const s of series) {
      const compiled = compileMathExpr(s.expr)
      if (!compiled.ok) continue
      const y = compiled.eval(x)
      if (Number.isFinite(y)) ys.push({ expr: s.expr, color: s.color, y })
    }
    setHover({ x, ys })
  }

  const errors = series.filter((s) => s.error)
  const empty = series.every((s) => !s.points.some(Boolean) && !s.error)

  return (
    <div className={cn("flex flex-col min-h-0", className)}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto rounded-[12px] bg-paper border border-line"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {xTicks.map((t) => (
          <g key={`x-${t}`}>
            <line x1={sx(t)} y1={padT} x2={sx(t)} y2={padT + ih} stroke="rgba(20,33,43,0.08)" strokeWidth="1" />
            <text x={sx(t)} y={H - 10} textAnchor="middle" fill="#8C9398" fontSize="11">
              {fmtTick(t)}
            </text>
          </g>
        ))}
        {yTicks.map((t) => (
          <g key={`y-${t}`}>
            <line x1={padL} y1={sy(t)} x2={padL + iw} y2={sy(t)} stroke="rgba(20,33,43,0.08)" strokeWidth="1" />
            <text x={padL - 6} y={sy(t) + 4} textAnchor="end" fill="#8C9398" fontSize="11">
              {fmtTick(t)}
            </text>
          </g>
        ))}
        {box.xMin <= 0 && box.xMax >= 0 && (
          <line x1={sx(0)} y1={padT} x2={sx(0)} y2={padT + ih} stroke="rgba(20,33,43,0.28)" strokeWidth="1.2" />
        )}
        {box.yMin <= 0 && box.yMax >= 0 && (
          <line x1={padL} y1={sy(0)} x2={padL + iw} y2={sy(0)} stroke="rgba(20,33,43,0.28)" strokeWidth="1.2" />
        )}
        {series.map((s) =>
          polylines(s).map((d, i) => (
            <polyline
              key={`${s.expr}-${i}`}
              fill="none"
              stroke={s.color}
              strokeWidth="2.2"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={d}
            />
          )),
        )}
        {hover && (
          <>
            <line
              x1={sx(hover.x)}
              y1={padT}
              x2={sx(hover.x)}
              y2={padT + ih}
              stroke="rgba(31,92,90,0.45)"
              strokeDasharray="4 3"
            />
            {hover.ys.map((item) => (
              <circle key={item.expr} cx={sx(hover.x)} cy={sy(item.y)} r="4" fill={item.color} />
            ))}
          </>
        )}
      </svg>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {series.map((s) => (
          <span key={s.expr} className="text-[11px] text-ink-soft flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 rounded-full" style={{ background: s.color }} />
            y = {s.expr}
          </span>
        ))}
      </div>
      {hover && (
        <div className="text-[11px] text-ink-disabled mt-1 font-mono">
          x = {fmtTick(hover.x)}
          {hover.ys.map((item) => (
            <span key={item.expr} className="ml-2" style={{ color: item.color }}>
              y = {fmtTick(item.y)}
            </span>
          ))}
        </div>
      )}
      {errors.map((s) => (
        <p key={s.expr} className="text-caption text-danger mt-1">
          {s.expr}：{s.error}
        </p>
      ))}
      {empty && !errors.length ? (
        <p className="text-caption text-ink-tertiary mt-2">这段区间里没有可画的点。</p>
      ) : null}
    </div>
  )
}
