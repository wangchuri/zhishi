import { Link } from "react-router-dom"
import { documentImageBase } from "@/lib/api"
import { MarkdownWithMath } from "@/components/blocks/MarkdownWithMath"
import { cn } from "@/lib/utils"

export type ChatTipPayload = {
  id: string
  title?: string | null
  content_md?: string | null
  document_id?: string | null
  document_name?: string | null
  page_number?: number | null
  tags?: string[]
  note_type?: string
  created_at?: string | null
  updated_at?: string | null
}

function sourceLabel(tip: ChatTipPayload): string {
  if (tip.document_name) return `《${tip.document_name}》`
  if (tip.page_number != null) return `第 ${tip.page_number} 页`
  return "未关联资料"
}

export function ChatTipCard({ tip, className }: { tip: ChatTipPayload; className?: string }) {
  const readerHref =
    tip.document_id != null
      ? `/companion/doc/${tip.document_id}${tip.page_number != null ? `?page=${tip.page_number}` : ""}`
      : null

  return (
    <article className={cn("tip-card is-chat", className)}>
      <span className="tip-card-mark">tip</span>
      <h4 className="font-display text-[15px] text-ink mb-2 leading-snug">{tip.title || "无标题"}</h4>

      <div className="tip-card-body flex-1 min-h-0">
        {tip.content_md?.trim() ? (
          tip.document_id ? (
            <MarkdownWithMath
              proseClass="prose prose-sm max-w-none text-ink-soft"
              imageBaseUrl={documentImageBase(tip.document_id)}
            >
              {tip.content_md}
            </MarkdownWithMath>
          ) : (
            <p className="text-[14px] leading-relaxed text-ink-soft whitespace-pre-wrap">{tip.content_md}</p>
          )
        ) : (
          <p className="quote text-[13px] leading-relaxed text-ink-soft">（空摘录）</p>
        )}
      </div>

      {(tip.tags || []).length > 0 ? (
        <div className="flex flex-wrap gap-1 mt-2 shrink-0">
          {(tip.tags || []).map((tag) => (
            <span key={tag} className="h-5 px-1.5 rounded-full bg-sea-subtle text-sea text-[10px] leading-5">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 mt-3 shrink-0">
        <span className="text-[11px] text-ink-disabled truncate">
          {sourceLabel(tip)}
          {tip.page_number != null && tip.document_name ? ` · 第 ${tip.page_number} 页` : ""}
        </span>
        {readerHref ? (
          <Link to={readerHref} className="text-[12px] text-sea shrink-0 hover:underline">
            在阅读页打开
          </Link>
        ) : null}
      </div>
    </article>
  )
}
