import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Brain, Library, Loader2 } from "lucide-react"
import { AppShell } from "@/components/layout/AppShell"
import { PageHeader } from "@/components/blocks/PageHeader"
import { EmptyState } from "@/components/ui/empty-state"
import { useKbDocuments } from "@/hooks/useKbDocuments"
import { kbApi, notesApi } from "@/lib/api"
import { getMarkedPages, getProgress } from "@/lib/companionStore"
import { CompanionBookCard } from "./CompanionBookCard"

export function CompanionPage() {
  const navigate = useNavigate()
  const {
    collections,
    selectedCollectionId,
    setSelectedCollectionId,
    selectedCollection,
    documents,
    loadingCollections,
    loadingDocuments,
  } = useKbDocuments({ preferZone: "study" })

  const [totalPagesMap, setTotalPagesMap] = useState<Record<string, number>>({})
  const [tipCountMap, setTipCountMap] = useState<Record<string, number>>({})

  const studyDocs = useMemo(() => {
    return documents.filter((d) => d.zone !== "life" || !selectedCollection?.zone)
  }, [documents, selectedCollection])

  // 预取每个文档的总页数 + tip 数（用于显示进度 / 计数）
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const pages: Record<string, number> = {}
      const tips: Record<string, number> = {}
      for (const doc of studyDocs) {
        if (cancelled) continue
        try {
          const res = await kbApi.getDocumentPages(doc.id)
          pages[doc.id] = res.total_pages ?? 0
        } catch {
          /* ignore */
        }
        try {
          const tipRes = await notesApi.listTips(doc.id)
          tips[doc.id] = tipRes.total ?? 0
        } catch {
          /* ignore */
        }
      }
      if (!cancelled) {
        setTotalPagesMap(pages)
        setTipCountMap(tips)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [studyDocs])

  return (
    <AppShell maxWidth={1180}>
      <PageHeader
        title="伴学"
        subtitle="按书阅读，随时向 AI 提问、把理解 tip 进笔记"
      />

      {loadingCollections ? (
        <div className="flex items-center justify-center py-20 text-ink-disabled gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>加载中...</span>
        </div>
      ) : collections.length === 0 ? (
        <EmptyState
          icon={Brain}
          title="暂无学习区知识库"
          description="请先在知识库上传学习区文档并等待分段完成"
          primaryAction={{ label: "去资料", onClick: () => navigate("/quiz") }}
        />
      ) : studyDocs.length === 0 ? (
        <EmptyState
          icon={Library}
          title="暂无文档"
          description="该分区还没有上传文档，上传资料后即可开始伴学阅读"
          primaryAction={{ label: "去资料", onClick: () => navigate("/quiz") }}
        />
      ) : (
        <div className="space-y-6">
          {collections.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {collections.map((coll) => (
                <button
                  key={coll.id}
                  type="button"
                  onClick={() => setSelectedCollectionId(coll.id === selectedCollectionId ? "" : coll.id)}
                  className={`px-3 py-1.5 rounded-lg text-small font-medium transition-colors
                    ${coll.id === selectedCollectionId
                      ? "bg-primary text-white"
                      : "bg-paper-2 text-ink-soft hover:bg-paper-2/80 border border-line-light"
                    }`}
                >
                  {coll.name}
                </button>
              ))}
            </div>
          )}

          {loadingDocuments && (
            <div className="flex items-center gap-2 text-small text-ink-disabled">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>加载文档...</span>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {studyDocs.map((doc) => (
              <CompanionBookCard
                key={doc.id}
                doc={doc}
                totalPages={totalPagesMap[doc.id] ?? doc.pdf_page_count ?? null}
                progress={getProgress(doc.id)}
                tipCount={tipCountMap[doc.id] ?? 0}
                markedCount={getMarkedPages(doc.id).length}
                onClick={() => navigate(`/companion/doc/${doc.id}`)}
              />
            ))}
          </div>
        </div>
      )}
    </AppShell>
  )
}
