import { SealMark } from "@/components/decor/PaperMotifs"

export function DayCompleteCard({ compact }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-sea/35 bg-sea-subtle px-3.5 py-3.5 text-center">
        <p className="text-caption font-medium text-sea">任务完成！</p>
        <p className="text-[11px] text-ink-soft mt-0.5">你离目标又近了一步</p>
      </div>
    )
  }
  return (
    <div className="relative overflow-hidden rounded-2xl border border-sea/35 bg-paper px-5 py-8 text-center shadow-[0_4px_20px_-2px_rgba(20,33,43,0.05)]">
      <div className="paper-grain pointer-events-none absolute inset-0 opacity-40" />
      <div className="relative">
        <SealMark className="mx-auto mb-3 w-14 h-14 text-sea" />
        <p className="font-display text-[1.35rem] text-ink">任务完成！</p>
        <p className="text-body text-ink-soft mt-1.5">你离目标又近了一步</p>
      </div>
    </div>
  )
}

export function TaskRefillHint({ compact }: { compact?: boolean }) {
  return (
    <div
      className={
        compact
          ? "rounded-2xl border border-dashed border-line bg-paper/70 px-3.5 py-3 text-center"
          : "relative overflow-hidden rounded-2xl border border-dashed border-line bg-paper/70 px-5 py-6 text-center"
      }
    >
      <p className={compact ? "text-caption text-ink-soft" : "text-body text-ink-soft"}>
        Tina 正在看今天还要不要再给任务…
      </p>
    </div>
  )
}
