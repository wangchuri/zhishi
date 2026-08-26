import { cn } from "@/lib/utils"
import { documentImageBase, type NoteItem } from "@/lib/api"
import { MarkdownWithMath } from "@/components/blocks/MarkdownWithMath"

function sourceLabel(tip: NoteItem): string {
  if (tip.document_name) return `《${tip.document_name}》`
  if (tip.page_number) return `第 ${tip.page_number} 页`
  return "未关联资料"
}

function textPreview(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/[#*`>_-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

export function TipDeck({
  tips,
  expanded,
  onCycle,
  onOpen,
  onPick,
}: {
  tips: NoteItem[]
  expanded: boolean
  onCycle: () => void
  onOpen: (id: string) => void
  onPick: (id: string) => void
}) {
  return (
    <div className={cn("tip-deck", expanded && "is-expanded")}>
      {tips.map((tip, i) => {
        const quote = textPreview(tip.content_md || "")
        const hasImg = /!\[[^\]]*\]\([^)]+\)/.test(tip.content_md || "")
        const depth = Math.min(i, 3)
        return (
          <article
            key={tip.id}
            className={cn("tip-card", !expanded && i === 0 && "is-front")}
            data-depth={depth}
            style={{ zIndex: tips.length - i }}
            onClick={() => {
              if (expanded) onPick(tip.id)
              else if (i === 0) onCycle()
            }}
          >
            <span className="tip-card-mark">tip</span>
            <h4 className="font-display text-[15px] text-ink mb-2 leading-snug">{tip.title || "无标题"}</h4>
            {quote ? (
              <p className="quote text-[13px] leading-relaxed text-ink-soft flex-1 line-clamp-3">
                「{quote}」
              </p>
            ) : hasImg && tip.document_id ? (
              <div
                className="flex-1 max-h-20 overflow-hidden [&_img]:max-h-16 [&_img]:rounded-md [&_p]:my-0"
                data-no-tip
                onClick={(e) => e.stopPropagation()}
              >
                <MarkdownWithMath
                  proseClass="prose prose-sm max-w-none"
                  imageBaseUrl={documentImageBase(tip.document_id)}
                >
                  {tip.content_md || ""}
                </MarkdownWithMath>
              </div>
            ) : (
              <p className="quote text-[13px] leading-relaxed text-ink-soft flex-1">（空）</p>
            )}
            {(tip.tags || []).length > 0 ? (
              <div className="flex flex-wrap gap-1 mt-2">
                {(tip.tags || []).slice(0, 4).map((tag) => (
                  <span key={tag} className="h-5 px-1.5 rounded-full bg-sea-subtle text-sea text-[10px] leading-5">
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-2 mt-3">
              <span className="text-[11px] text-ink-disabled truncate">
                {sourceLabel(tip)}
                {tip.page_number != null ? ` · 第 ${tip.page_number} 页` : ""}
              </span>
              <button
                type="button"
                className="text-[12px] text-sea shrink-0 hover:underline"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpen(tip.id)
                }}
              >
                打开
              </button>
            </div>
          </article>
        )
      })}
    </div>
  )
}
