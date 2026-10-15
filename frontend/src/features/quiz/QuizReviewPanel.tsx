import type { QuizReviewItem } from "@/types"
import { Link } from "react-router-dom"
import { CitationCard } from "@/components/blocks/CitationCard"
import { MessageImages } from "@/components/blocks/ImageAttachments"
import { MarkdownWithMath } from "@/components/blocks/MarkdownWithMath"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface QuizReviewPanelProps {
  items: QuizReviewItem[]
  onAskTutor?: (item: QuizReviewItem) => void
  className?: string
}

export function QuizReviewPanel({ items, onAskTutor, className }: QuizReviewPanelProps) {
  if (items.length === 0) {
    return (
      <div className={cn("text-small text-ink-tertiary", className)}>
        暂无错题，继续加油！
      </div>
    )
  }

  return (
    <div className={cn("space-y-4", className)}>
      {items.map((item) => (
        <div
          key={item.question_id}
          className="rounded-lg border border-line-soft bg-surface-soft p-4 space-y-2"
        >
          <div className="flex items-start justify-between gap-2">
            <MarkdownWithMath className="text-body font-medium leading-snug flex-1 min-w-0">
              {item.stem}
            </MarkdownWithMath>
            <Badge variant={item.status === "unknown" ? "warning" : "danger"}>
              {item.status === "unknown" ? "我不会" : "答错"}
            </Badge>
          </div>
          {item.attachments && item.attachments.length > 0 && (
            <MessageImages ids={item.attachments} />
          )}
          <div className="text-small text-ink-secondary">
            你的答案：
            {item.user_answer || (item.attachments?.length ? "（图片作答）" : "—")} · 正确答案：
            {item.correct_answer}
          </div>
          {item.explanation && (
            <div className="text-small text-ink-primary bg-surface rounded-md p-2.5 border border-line-soft">
              <MarkdownWithMath proseClass="prose prose-sm max-w-none prose-p:my-0 prose-p:text-ink-primary">
                {item.explanation}
              </MarkdownWithMath>
            </div>
          )}
          {item.citation && (
            <CitationCard citation={item.citation} variant="compact" />
          )}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link
              to={`/quiz/question/${item.question_id}`}
              className="text-small text-ink-soft hover:text-sea transition-colors"
            >
              查看这道题 →
            </Link>
            {onAskTutor && (
              <button
                type="button"
                onClick={() => onAskTutor(item)}
                className="text-small text-primary hover:underline"
              >
                和 Agent 聊聊 →
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
