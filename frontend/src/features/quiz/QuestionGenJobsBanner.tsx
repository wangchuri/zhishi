import { useState } from "react"
import { ChevronRight, Loader2, Sparkles } from "lucide-react"
import type { QuestionGenJob } from "@/types"
import { QuestionGenJobLiveDialog } from "./QuestionGenJobLiveDialog"

function pagesLabel(pages: number[]) {
  if (!pages.length) return "全书"
  if (pages.length === 1) return `第 ${pages[0]} 页`
  if (pages.length <= 4) return `第 ${pages.join("、")} 页`
  return `${pages.length} 页`
}

export function QuestionGenJobsBanner({ jobs }: { jobs: QuestionGenJob[] }) {
  const [liveId, setLiveId] = useState<string | null>(null)
  if (jobs.length === 0) return null

  return (
    <>
      <div className="rounded-lg border border-primary/30 bg-primary-soft px-4 py-3 space-y-2">
        {jobs.map((job) => (
          <button
            key={job.id}
            type="button"
            onClick={() => setLiveId(job.id)}
            className="w-full flex items-start gap-3 text-left rounded-md hover:bg-primary/5 transition-colors -mx-1 px-1 py-0.5"
          >
            <Loader2 className="w-5 h-5 animate-spin text-primary shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="text-body text-ink-primary flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
                <span>
                  Agent 正在为「{job.document_name}」出题
                </span>
              </div>
              <div className="text-caption text-ink-secondary mt-0.5">
                {pagesLabel(job.page_numbers || [])}
                {" · "}
                {job.max_concurrency ? `并行 ${job.max_concurrency} 路` : null}
                {job.max_concurrency ? " · " : null}
                {(job.agents || []).filter((a) => a.status === "running").length > 0
                  ? `${(job.agents || []).filter((a) => a.status === "running").length} 个 Agent 工作中 · `
                  : null}
                {job.questions_per_page > 0
                  ? `已提交 ${job.submitted}/${job.total_cap} 题`
                  : `已提交 ${job.submitted} 题（按内容自行决定）`}
                {" · "}
                <span className="text-sea">点击查看过程</span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-ink-tertiary shrink-0 mt-1" />
          </button>
        ))}
      </div>
      <QuestionGenJobLiveDialog
        jobId={liveId}
        open={!!liveId}
        onOpenChange={(open) => {
          if (!open) setLiveId(null)
        }}
      />
    </>
  )
}
