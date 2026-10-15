import { useMemo, useState } from "react"
import { FileText, Loader2, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface PaperMaxByType {
  single_choice: number
  fill_blank: number
  application: number
  material: number
}

const ROWS: Array<{ key: keyof PaperMaxByType; label: string; hint: string }> = [
  { key: "single_choice", label: "单选题", hint: "四选一" },
  { key: "fill_blank", label: "填空题", hint: "完形/填空" },
  { key: "application", label: "应用题", hint: "计算/综合" },
  { key: "material", label: "材料题", hint: "阅读/完形短文（整段）" },
]

/** 试卷模式：输入各题型数量，随机组一套卷子开刷。 */
export function QuizPaperPanel({
  maxByType,
  onStart,
  starting,
}: {
  maxByType: PaperMaxByType
  onStart: (counts: Record<string, number>) => void
  starting?: boolean
}) {
  const [counts, setCounts] = useState<Record<string, string>>({
    single_choice: "",
    fill_blank: "",
    application: "",
    material: "",
  })

  const total = useMemo(
    () => ROWS.reduce((sum, r) => sum + (Number(counts[r.key]) || 0), 0),
    [counts],
  )

  const setCount = (key: keyof PaperMaxByType, raw: string) => {
    const n = Math.max(0, Math.min(Number(raw) || 0, maxByType[key]))
    setCounts((prev) => ({ ...prev, [key]: raw === "" ? "" : String(n) }))
  }

  const start = () => {
    const payload: Record<string, number> = {}
    for (const r of ROWS) {
      const n = Number(counts[r.key]) || 0
      if (n > 0) payload[r.key] = n
    }
    if (Object.keys(payload).length === 0) return
    onStart(payload)
  }

  return (
    <div className="bg-surface border border-line-soft rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-sea" strokeWidth={2} />
          <span className="text-card-title font-semibold text-ink-primary">试卷模式</span>
        </div>
        <span className="text-caption text-ink-tertiary">随机按题型组卷，约 {total} 题</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {ROWS.map((r) => {
          const max = maxByType[r.key]
          const disabled = max === 0
          return (
            <label
              key={r.key}
              className={cn(
                "rounded-lg border p-2.5 transition-colors",
                disabled ? "border-line-soft opacity-50" : "border-line-soft hover:border-line",
              )}
              title={r.hint}
            >
              <div className="text-small font-medium text-ink-primary mb-1">{r.label}</div>
              <input
                type="number"
                min={0}
                max={max}
                disabled={disabled}
                value={counts[r.key]}
                onChange={(e) => setCount(r.key, e.target.value)}
                placeholder="0"
                className="w-full h-8 px-2 rounded-md border border-line-soft bg-paper text-body text-ink focus:outline-none focus:border-sea disabled:cursor-not-allowed"
              />
              <div className="text-[11px] text-ink-tertiary mt-1">最多 {max}</div>
            </label>
          )
        })}
      </div>

      <Button
        variant="primary"
        size="lg"
        onClick={start}
        disabled={starting || total === 0}
        className="w-full"
        style={{ color: "#FFFFFF" }}
      >
        {starting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Play className="w-4 h-4" strokeWidth={2} />
        )}
        生成试卷并开始
      </Button>
    </div>
  )
}
