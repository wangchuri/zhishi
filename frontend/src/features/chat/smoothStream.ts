/** 把乱到的 SSE 字流梳成按帧匀速出现，积压少时一次一字，方便做淡入。 */

export type StreamKind = "text" | "reasoning"

export function createSmoothStream(
  sink: (piece: string, kind: StreamKind) => void,
) {
  let textQ = ""
  let reasonQ = ""
  let raf = 0
  let stopped = false
  let last = 0
  let acc = 0

  const take = (q: string, n: number): [string, string] => {
    if (!q || n <= 0) return ["", q]
    const count = Math.min(q.length, n)
    return [q.slice(0, count), q.slice(count)]
  }

  const tick = (now: number) => {
    raf = 0
    if (stopped) return
    if (!last) last = now
    const dt = Math.min(48, now - last)
    last = now
    const backlog = textQ.length + reasonQ.length
    const cps = backlog > 96 ? 140 : backlog > 32 ? 64 : 38
    acc += (dt / 1000) * cps
    let n = Math.floor(acc)
    if (n < 1 && backlog) n = 1
    acc = Math.max(0, acc - n)

    if (reasonQ) {
      const [rOut, rRest] = take(reasonQ, n)
      reasonQ = rRest
      n -= rOut.length
      if (rOut) sink(rOut, "reasoning")
    }
    if (n > 0 && textQ) {
      const [tOut, tRest] = take(textQ, n)
      textQ = tRest
      if (tOut) sink(tOut, "text")
    }
    if (textQ || reasonQ) raf = window.requestAnimationFrame(tick)
  }

  const schedule = () => {
    if (!raf && !stopped) raf = window.requestAnimationFrame(tick)
  }

  return {
    push(piece: string, kind: StreamKind) {
      if (stopped || !piece) return
      if (kind === "reasoning") reasonQ += piece
      else textQ += piece
      schedule()
    },
    flush() {
      const r = reasonQ
      const t = textQ
      reasonQ = ""
      textQ = ""
      if (r) sink(r, "reasoning")
      if (t) sink(t, "text")
    },
    stop() {
      stopped = true
      if (raf) window.cancelAnimationFrame(raf)
      raf = 0
    },
  }
}
