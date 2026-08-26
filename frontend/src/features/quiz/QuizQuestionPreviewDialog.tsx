import { useMemo, useState } from "react"
import { Loader2, Search } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { MarkdownWithMath } from "@/components/blocks/MarkdownWithMath"
import { getApiBase } from "@/lib/api"
import { splitTagLabels } from "@/lib/utils"
import type { Question } from "@/types"

const TYPE_LABEL: Record<string, string> = {
  single_choice: "单选题",
  multiple_choice: "多选题",
  fill_blank: "填空题",
  short_answer: "简答题",
  application: "应用题",
  custom: "自定义题",
}

function statusBadge(q: Question) {
  if (!q.attempt_count) return { label: "未做", variant: "neutral" as const }
  if (q.user_answer_status === "correct") return { label: "答对", variant: "success" as const }
  if (q.user_answer_status === "wrong") return { label: "答错", variant: "danger" as const }
  if (q.user_answer_status === "unknown") return { label: "不会", variant: "warning" as const }
  return { label: "已做", variant: "neutral" as const }
}

export function QuizQuestionPreviewDialog({
  open,
  onOpenChange,
  documentId,
  documentName,
  questions,
  loading,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  documentId?: string
  documentName?: string
  questions: Question[]
  loading?: boolean
}) {
  const [keyword, setKeyword] = useState("")
  const imageBase = documentId
    ? `${getApiBase().replace(/\/$/, "")}/api/v1/kb/documents/${encodeURIComponent(documentId)}/images`
    : undefined

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase()
    if (!k) return questions
    return questions.filter((q) => {
      const stem = (q.stem || "").toLowerCase()
      const tags = (q.tags || []).join(" ").toLowerCase()
      const type = (TYPE_LABEL[q.question_type] || q.question_type || "").toLowerCase()
      return stem.includes(k) || tags.includes(k) || type.includes(k)
    })
  }, [questions, keyword])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setKeyword("")
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col gap-3 p-5">
        <DialogHeader>
          <DialogTitle>题目一览</DialogTitle>
          <DialogDescription>
            {documentName ? `「${documentName}」` : "本题库"}共 {questions.length} 题，预览题干与题型，不显示答案
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-disabled" strokeWidth={2} />
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索题干、题型或标签"
            className="w-full h-10 pl-9 pr-3 rounded-[4px] bg-paper-2 border border-line text-body text-ink placeholder:text-ink-disabled focus:outline-none focus:border-sea"
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin pr-1 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-ink-tertiary">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-body">加载题目...</span>
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-body text-ink-tertiary text-center py-12">
              {questions.length === 0 ? "还没有题目" : "没有匹配的题目"}
            </p>
          ) : (
            filtered.map((q, i) => {
              const status = statusBadge(q)
              return (
                <div
                  key={q.id || `${i}`}
                  className="rounded-lg border border-line-soft bg-surface p-3.5"
                >
                  <div className="flex items-start gap-2 mb-2">
                    <span className="text-caption text-ink-tertiary shrink-0 mt-0.5 w-6">
                      {i + 1}.
                    </span>
                    <div className="min-w-0 flex-1">
                      <MarkdownWithMath className="text-body text-ink-primary leading-relaxed" imageBaseUrl={imageBase}>
                        {q.stem || "（无题干）"}
                      </MarkdownWithMath>
                    </div>
                    <Badge variant={status.variant} size="sm">{status.label}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pl-8">
                    <Badge variant="primary" size="sm">
                      {TYPE_LABEL[q.question_type] || q.question_type || "题目"}
                    </Badge>
                    {(q.tags || []).flatMap(splitTagLabels).slice(0, 8).map((tag) => (
                      <Badge key={tag} variant="neutral" size="sm">{tag}</Badge>
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
