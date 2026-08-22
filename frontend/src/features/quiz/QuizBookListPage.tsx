import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Brain, Loader2, Library, Upload } from "lucide-react"
import { AppShell } from "@/components/layout/AppShell"
import { PageHeader } from "@/components/blocks/PageHeader"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { useKbDocuments } from "@/hooks/useKbDocuments"
import { questionsApi } from "@/lib/api"
import { QuizBookCard, type BookCardStats } from "./QuizBookCard"
import { QuestionGenJobsBanner } from "./QuestionGenJobsBanner"
import type { QuestionGenJob } from "@/types"

export function QuizBookListPage() {
  const navigate = useNavigate()
  const {
    collections,
    selectedCollectionId,
    setSelectedCollectionId,
    selectedCollection,
    documents,
    loadingCollections,
  } = useKbDocuments({ preferZone: "study" })

  const [statsMap, setStatsMap] = useState<Record<string, BookCardStats>>({})
  const [loadingStats, setLoadingStats] = useState(false)
  const [genJobs, setGenJobs] = useState<QuestionGenJob[]>([])
  const [statsEpoch, setStatsEpoch] = useState(0)
  const hadJobsRef = useRef(false)

  // 只展示学习区文档
  const studyDocs = useMemo(() => {
    return documents.filter((d) => d.zone !== "life" || !selectedCollection?.zone)
  }, [documents, selectedCollection])

  // 加载每个文档的做题统计
  useEffect(() => {
    if (studyDocs.length === 0) return
    let cancelled = false
    setLoadingStats(true)

    const loadAll = async () => {
      const results: Record<string, BookCardStats> = {}
      for (const doc of studyDocs) {
        if (cancelled) return
        try {
          const res = await questionsApi.list({ document_id: doc.id })
          const items = res.questions || []
          const total = res.total ?? (Array.isArray(items) ? items.length : 0)
          const answered = res.answered_count ?? 0
          results[doc.id] = {
            total,
            answered,
            correct: res.correct_count ?? 0,
            wrong: res.wrong_count ?? 0,
            unknown: res.unknown_count ?? 0,
          }
        } catch {
          results[doc.id] = { total: 0, answered: 0, correct: 0, wrong: 0, unknown: 0 }
        }
      }
      if (!cancelled) setStatsMap(results)
    }

    loadAll().finally(() => {
      if (!cancelled) setLoadingStats(false)
    })

    return () => { cancelled = true }
  }, [studyDocs, statsEpoch])

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const res = await questionsApi.listJobs()
        const jobs = res.jobs || []
        if (cancelled) return
        setGenJobs(jobs)
        if (hadJobsRef.current && jobs.length === 0) {
          setStatsEpoch((n) => n + 1)
        }
        hadJobsRef.current = jobs.length > 0
      } catch {
        if (!cancelled) setGenJobs([])
      }
    }
    void tick()
    const timer = window.setInterval(tick, 2500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const processingIds = useMemo(
    () => new Set(genJobs.map((j) => j.document_id)),
    [genJobs]
  )

  return (
    <AppShell maxWidth={1180}>
      <PageHeader
        title="资料"
        subtitle="你的书本、题目都在这里"
      >
        <Button variant="primary" size="md" onClick={() => navigate("/knowledge/upload")}>
          <Upload className="w-4 h-4 mr-2" strokeWidth={2} />
          上传
        </Button>
      </PageHeader>

      {loadingCollections ? (
        <div className="flex items-center justify-center py-20 text-ink-tertiary gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>加载中...</span>
        </div>
      ) : collections.length === 0 ? (
        <EmptyState
          icon={Brain}
          title="暂无资料"
          description="先上传学习资料，解析完成后会显示在这里"
          primaryAction={{ label: "去上传", onClick: () => navigate("/knowledge/upload") }}
        />
      ) : studyDocs.length === 0 ? (
        <EmptyState
          icon={Library}
          title="暂无文档"
          description="还没有上传文档，上传后即可刷题、出题"
          primaryAction={{ label: "去上传", onClick: () => navigate("/knowledge/upload") }}
        />
      ) : (
        <div className="space-y-6">
          <QuestionGenJobsBanner jobs={genJobs} />
          {/* 集合选择器 */}
          {collections.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {collections.map((coll) => (
                <button
                  key={coll.id}
                  type="button"
                  onClick={() => setSelectedCollectionId(coll.id === selectedCollectionId ? "" : coll.id)}
                  className={`px-3 py-1.5 rounded-lg text-small font-medium transition-colors
                    ${coll.id === selectedCollectionId || (!selectedCollectionId && coll.id === selectedCollectionId)
                      ? "bg-primary text-white"
                      : "bg-surface-soft text-ink-secondary hover:bg-surface-soft/80 border border-line-soft"
                    }`}
                >
                  {coll.name}
                </button>
              ))}
            </div>
          )}

          {loadingStats && (
            <div className="flex items-center gap-2 text-small text-ink-tertiary">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>加载统计...</span>
            </div>
          )}

          {/* 书本卡片网格 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {studyDocs.map((doc) => (
              <QuizBookCard
                key={doc.id}
                doc={
                  processingIds.has(doc.id)
                    ? { ...doc, question_gen_status: "processing" }
                    : doc
                }
                stats={statsMap[doc.id] ?? null}
                onClick={() => navigate(`/quiz/doc/${doc.id}`)}
              />
            ))}
          </div>
        </div>
      )}
    </AppShell>
  )
}