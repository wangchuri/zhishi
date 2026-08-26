import { useEffect, useRef } from "react"
import { Flame } from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"

/**
 * 连对庆祝弹窗：连对 ≥3 道时弹出，并播放上扬音效。
 * 用 Web Audio API 合成提示音，无需外部音频文件。
 */
export function StreakCelebrationDialog({
  open,
  streak,
  onClose,
}: {
  open: boolean
  streak: number
  onClose: () => void
}) {
  const audioCtxRef = useRef<AudioContext | null>(null)

  // 弹窗打开时播放音效（递增三音，类似"叮~叮~叮~"）
  useEffect(() => {
    if (!open) return
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    if (!audioCtxRef.current) audioCtxRef.current = new Ctx()
    const ctx = audioCtxRef.current
    if (ctx.state === "suspended") void ctx.resume()

    const notes = [523.25, 659.25, 783.99] // C5 E5 G5
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = "sine"
      osc.frequency.value = freq
      const t = ctx.currentTime + i * 0.12
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.25, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.5)
    })
  }, [open])

  useEffect(() => {
    return () => {
      if (audioCtxRef.current) void audioCtxRef.current.close()
    }
  }, [])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="max-w-xs text-center bg-surface"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="flex flex-col items-center gap-3 py-4">
          <div className="relative">
            <Flame className="w-14 h-14 text-warning animate-bounce" strokeWidth={1.5} />
            <span className="absolute -top-1 -right-2 w-3 h-3 rounded-full bg-warning/60 animate-ping" />
          </div>
          <DialogTitle className="text-2xl font-bold text-ink-primary">
            连对 {streak} 道！
          </DialogTitle>
          <p className="text-small text-ink-secondary">太厉害了，继续加油！</p>
          <button
            type="button"
            onClick={onClose}
            className="mt-2 rounded-lg bg-primary text-white px-8 py-2 text-body font-medium hover:opacity-90 transition-opacity"
            style={{ color: '#FFFFFF' }}
          >
            继续
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
