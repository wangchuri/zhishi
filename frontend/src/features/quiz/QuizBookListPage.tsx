import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Brain, Loader2, Library } from "lucide-react"
import { AppShell } from "@/components/layout/AppShell"
import { PageHeader } from "@/components/blocks/PageHeader"
import { EmptyState } from "@/components/ui/empty-state"
import { useKbDocuments } from "@/hooks/useKbDocuments"
import { questionsApi } from "@/lib/api"
import { QuizBookCard, type BookCardStats } from "./QuizBookCard"

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
  }, [studyDocs])

  return (
    <AppShell maxWidth={1180}>
      <PageHeader
        title="题库"
        subtitle="选择一份文档开始刷题练习"
      />

      {loadingCollections ? (
        <div className="flex items-center justify-center py-20 text-ink-tertiary gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>加载中...</span>
        </div>
      ) : collections.length === 0 ? (
        <EmptyState
          icon={Brain}
          title="暂无知识库分区"
          description="请先在知识库上传学习区文档并等待分段完成"
          primaryAction={{ label: "去知识库", onClick: () => navigate("/knowledge") }}
        />
      ) : studyDocs.length === 0 ? (
        <EmptyState
          icon={Library}
          title="暂无文档"
          description="该分区还没有上传文档，上传资料后可在此刷题练习"
          primaryAction={{ label: "去知识库", onClick: () => navigate("/knowledge") }}
        />
      ) : (
        <div className="space-y-6">
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
                doc={doc}
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