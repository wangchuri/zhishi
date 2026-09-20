import { useState } from "react"
import { MarkdownWithMath } from "@/components/blocks/MarkdownWithMath"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface QuestionOption {
  key: string
  text: string
}

export interface QuestionData {
  stem?: string
  question_type?: string
  options?: QuestionOption[] | null
  answer?: string | null
  explanation?: string | null
}

export function InteractiveQuestion({ q, compact }: { q: QuestionData; compact?: boolean }) {
  const isChoice = !q.question_type || q.question_type === "single_choice"
  const options = q.options || []
  const [selected, setSelected] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const answered = selected !== null || revealed
  const correct = (q.answer || "").trim().toUpperCase()

  return (
    <div className={cn("space-y-2", compact ? "text-caption" : "text-body")}>
      <div className="text-ink leading-relaxed">
        <MarkdownWithMath>{q.stem || ""}</MarkdownWithMath>
      </div>

      {isChoice && options.length > 0 ? (
        <div className="space-y-1">
          {options.map((o) => {
            const isSel = selected === o.key
            const isCorrect = answered && o.key.toUpperCase() === correct
            const isWrong = answered && isSel && o.key.toUpperCase() !== correct
            return (
              <button
                key={o.key}
                type="button"
                disabled={answered}
                onClick={() => setSelected(o.key)}
                className={cn(
                  "w-full text-left text-caption rounded-md border px-2 py-1.5 transition-colors",
                  isCorrect
                    ? "border-success bg-success-soft text-success"
                    : isWrong
                      ? "border-danger bg-danger-soft text-danger"
                      : isSel
                        ? "border-sea bg-sea-subtle text-ink"
                        : "border-line-light text-ink-soft hover:border-sea/40",
                )}
              >
                <span className="font-medium mr-1">{o.key}.</span>
                {o.text}
              </button>
            )
          })}
        </div>
      ) : null}

      {!isChoice && !revealed ? (
        <Button variant="secondary" size="sm" onClick={() => setRevealed(true)}>
          看答案
        </Button>
      ) : null}

      {answered ? (
        <div className="rounded-md bg-paper px-2 py-1.5 text-[11px] text-ink-soft space-y-1">
          <div>
            答案：<span className="text-sea font-medium">{correct || "—"}</span>
          </div>
          {q.explanation ? (
            <div>
              <MarkdownWithMath>{q.explanation}</MarkdownWithMath>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
