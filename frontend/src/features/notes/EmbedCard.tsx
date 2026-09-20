import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { BookOpen, ChevronDown, Lightbulb, ListChecks, type LucideIcon } from "lucide-react"
import { MarkdownWithMath } from "@/components/blocks/MarkdownWithMath"
import { InteractiveQuestion, type QuestionData } from "@/features/notes/InteractiveQuestion"
import { materialsApi, notesApi, questionsApi } from "@/lib/api"
import { cn } from "@/lib/utils"

export type EmbedKind = "tip" | "question" | "material"

const META: Record<EmbedKind, { label: string; icon: LucideIcon; accent: string }> = {
  tip: { label: "tip", icon: Lightbulb, accent: "border-l-sea" },
  question: { label: "题目", icon: ListChecks, accent: "border-l-ember" },
  material: { label: "材料", icon: BookOpen, accent: "border-l-mist" },
}

/**
 * 正文里的嵌入卡片：默认只显示标题，点击展开/收起。
 * - tip / 材料：展开显示全文
 * - 题目：展开后可交互作答
 */
export function EmbedCard({
  kind,
  id,
  style,
}: {
  kind: EmbedKind
  id: string
  style?: string
}) {
  const navigate = useNavigate()
  const meta = META[kind] || META.tip
  const Icon = meta.icon

  const [open, setOpen] = useState(false)
  const [missing, setMissing] = useState(false)
  const [title, setTitle] = useState("")
  const [bodyText, setBodyText] = useState("")
  const [question, setQuestion] = useState<QuestionData | null>(null)
  const [target, setTarget] = useState("")

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        if (kind === "tip") {
          const n = await notesApi.get(id)
          if (cancelled) return
          setTitle(n.title || "tip")
          setBodyText(n.content_md || "")
          setTarget(`/notes/${id}`)
        } else if (kind === "question") {
          const q = await questionsApi.get(id)
          if (cancelled) return
          setTitle((q.stem || "题目").replace(/[#*`>_]/g, " ").replace(/\s+/g, " ").slice(0, 60))
          setQuestion({
            stem: q.stem,
            question_type: q.question_type,
            options: q.options,
            answer: q.answer,
            explanation: q.explanation,
          })
          if (q.document_id) setTarget(`/quiz/doc/${q.document_id}`)
        } else {
          const m = await materialsApi.get(id)
          if (cancelled) return
          setTitle(m.title || "材料")
          setBodyText(m.content || "")
          if (m.document_id) setTarget(`/knowledge/doc/${m.document_id}`)
        }
      } catch {
        if (!cancelled) setMissing(true)
      }
    }
    if (id) void run()
    return () => {
      cancelled = true
    }
  }, [kind, id])

  return (
    <div
      className={cn(
        "my-2 rounded-lg border border-line-light border-l-[3px] bg-paper-2/50 transition-colors",
        meta.accent,
        open && "border-sea/40",
      )}
      data-embed-kind={kind}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-left"
        title={open ? "收起" : "展开"}
      >
        <Icon className="w-3.5 h-3.5 text-ink-disabled shrink-0" strokeWidth={2} />
        <span className="text-[11px] uppercase tracking-wide text-ink-disabled shrink-0">
          {meta.label}
        </span>
        <span className="flex-1 truncate-1 text-caption text-ink">
          {missing ? "（引用失效）" : title || "…"}
        </span>
        {style ? <span className="text-[10px] text-ink-disabled shrink-0">{style}</span> : null}
        <ChevronDown
          className={cn("w-3.5 h-3.5 text-ink-disabled shrink-0 transition-transform", open && "rotate-180")}
          strokeWidth={2}
        />
      </button>

      {open ? (
        <div className="px-2.5 pb-2.5 border-t border-line-light">
          {kind === "question" && question ? (
            <div className="pt-2">
              <InteractiveQuestion q={question} compact />
            </div>
          ) : (
            <div className="pt-2 text-caption text-ink leading-relaxed">
              <MarkdownWithMath>{bodyText}</MarkdownWithMath>
            </div>
          )}
          {target ? (
            <button
              type="button"
              onClick={() => navigate(target)}
              className="mt-2 text-[11px] text-sea hover:underline"
            >
              打开来源
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
