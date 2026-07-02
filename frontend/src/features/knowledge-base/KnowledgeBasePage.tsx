import { useState, useEffect, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import {
  Library,
  FileText,
  Type,
  Hash,
  Activity,
  Clock,
  Upload,
  GraduationCap,
  Home,
} from "lucide-react"
import { AppShell } from "@/components/layout/AppShell"
import { PageHeader } from "@/components/blocks/PageHeader"
import { EmptyState } from "@/components/ui/empty-state"
import { StatCard } from "@/components/ui/stat-card"
import { SearchInput } from "@/components/ui/search-input"
import { Button } from "@/components/ui/button"
import { DocRow } from "@/components/blocks/DocRow"
import { SegmentedTabs } from "@/components/ui/segmented-tabs"
import { Badge } from "@/components/ui/badge"
import { DocumentPreviewModal } from "@/components/blocks/DocumentPreviewModal"
import { kbApi } from "@/lib/api"
import type { KbCollection, KnowledgeDoc } from "@/types"

export function KnowledgeBasePage() {
  const navigate = useNavigate()
  const [collections, setCollections] = useState<KbCollection[]>([])
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>("")
  const [docs, setDocs] = useState<KnowledgeDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [previewDocId, setPreviewDocId] = useState<string | null>(null)
  const [previewTitle, setPreviewTitle] = useState<string>("")

  const selectedCollection = collections.find((c) => c.id === selectedCollectionId)

  const loadDocuments = useCallback(async (collectionId: string, zone?: string) => {
    setLoading(true)
    try {
      const res = await kbApi.listDocuments(1, 50, collectionId || undefined)
      const items = res.documents || []
      setDocs(
        items.map((d: Record<string, unknown>) => ({
          id: String(d.id),
          name: String(d.name || d.file_name || d.id),
          type: mapFileType(d),
          tags: (d.tags as string[]) || [],
          status: mapStatus(d),
          segment_status: String(d.segment_status || "not_started"),
          question_gen_status: String(d.question_gen_status || "not_started"),
          zone,
          wordCount: Number(d.word_count || d.wordCount || 0),
          updatedAt: String(d.updated_at || d.updatedAt || "—"),
        }))
      )
    } catch {
      setDocs([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    kbApi
      .listCollections()
      .then((res) => {
        const cols = (res.collections || []) as KbCollection[]
        setCollections(cols)
        const defaultCol = cols.find((c) => c.is_default) || cols[0]
        if (defaultCol) setSelectedCollectionId(defaultCol.id)
      })
      .catch(() => setCollections([]))
  }, [])

  useEffect(() => {
    if (selectedCollectionId) {
      loadDocuments(selectedCollectionId, selectedCollection?.zone)
    }
  }, [selectedCollectionId, selectedCollection?.zone, loadDocuments])

  const handleDocClick = (doc: KnowledgeDoc) => {
    setPreviewDocId(doc.id)
    setPreviewTitle(doc.name)
  }

  const kbStats = {
    docs: docs.length,
    words: docs.reduce((s, d) => s + (d.wordCount || 0), 0),
    status: "已连接",
    pending: docs.filter((d) => d.status === "processing").length,
  }

  const zoneLabel = (zone?: string) => {
    if (zone === "life") return { text: "生活区", icon: Home }
    return { text: "学习区", icon: GraduationCap }
  }

  const zone = zoneLabel(selectedCollection?.zone)

  return (
    <AppShell maxWidth={1180}>
      <PageHeader
        title="知识库管理"
        subtitle="按分区管理文档，学习区支持分段与刷题"
      >
        <Button variant="secondary" size="md">
          <Type className="w-4 h-4" strokeWidth={2} />
          输入文本
        </Button>
        <Button variant="primary" size="md" onClick={() => navigate("/knowledge/upload")}>
          <Upload className="w-4 h-4" strokeWidth={2} />
          上传文件
        </Button>
      </PageHeader>

      {collections.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <SegmentedTabs
            tabs={collections.map((c) => ({
              label: c.name,
              value: c.id,
              icon: c.zone === "life" ? Home : GraduationCap,
            }))}
            value={selectedCollectionId}
            onChange={setSelectedCollectionId}
          />
          {selectedCollection && (
            <Badge variant={selectedCollection.zone === "life" ? "neutral" : "info"}>
              <zone.icon className="w-3 h-3 mr-1 inline" strokeWidth={2} />
              {zone.text}
            </Badge>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon={FileText} label="文档" value={kbStats.docs} tone="primary" />
        <StatCard icon={Hash} label="字数" value={kbStats.words.toLocaleString()} tone="info" />
        <StatCard icon={Activity} label="状态" value={kbStats.status} tone="success" />
        <StatCard icon={Clock} label="待处理" value={kbStats.pending} tone="warning" />
      </div>

      <div className="flex items-center gap-3 mb-5">
        <div className="flex-1 max-w-md">
          <SearchInput placeholder="搜索文档..." />
        </div>
      </div>

      {loading ? (
        <div className="bg-surface border border-line-soft rounded-lg shadow-xs p-12 flex items-center justify-center">
          <div className="flex items-center gap-2 text-ink-tertiary">
            <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span className="text-body">加载中...</span>
          </div>
        </div>
      ) : docs.length === 0 ? (
        <div className="bg-surface border border-line-soft rounded-lg shadow-xs">
          <EmptyState
            icon={Library}
            title="该分区还没有文档"
            description="上传资料后，Tina 可以帮你摘要、打标签并建立知识关系。"
            primaryAction={{
              label: "添加文档",
              onClick: () => navigate("/knowledge/upload"),
            }}
            size="lg"
          />
        </div>
      ) : (
        <div className="bg-surface border border-line-soft rounded-lg shadow-xs overflow-hidden">
          <div className="hidden sm:grid grid-cols-[minmax(0,2fr)_auto_auto_auto_auto] gap-x-4 px-5 py-3 border-b border-line-soft bg-surface-soft text-small text-ink-tertiary font-medium">
            <div>文档名</div>
            <div className="min-w-[60px]">类型</div>
            <div className="min-w-[60px]">字数</div>
            <div className="min-w-[80px]">更新时间</div>
            <div className="min-w-[80px] text-right">状态</div>
          </div>
          <div className="divide-y divide-line-soft">
            {docs.map((doc) => (
              <div key={doc.id} onClick={() => handleDocClick(doc)} className="cursor-pointer">
                <DocRow doc={doc} />
              </div>
            ))}
          </div>
        </div>
      )}

      {previewDocId && (
        <DocumentPreviewModal
          docId={previewDocId}
          title={previewTitle}
          onClose={() => setPreviewDocId(null)}
        />
      )}
    </AppShell>
  )
}

function mapFileType(d: Record<string, unknown>): KnowledgeDoc["type"] {
  const name = String(d.name || d.file_name || "").toLowerCase()
  if (name.endsWith(".pdf")) return "pdf"
  if (name.endsWith(".txt")) return "txt"
  if (name.endsWith(".md")) return "md"
  if (name.endsWith(".docx") || name.endsWith(".doc")) return "docx"
  return "txt"
}

function mapStatus(d: Record<string, unknown>): KnowledgeDoc["status"] {
  const s = String(d.indexing_status || d.status || "").toLowerCase()
  if (s === "completed" || s === "indexed") return "indexed"
  if (s === "processing" || s === "parsing" || s === "splitting" || s === "indexing")
    return "processing"
  if (s === "error" || s === "failed") return "failed"
  return "pending"
}
