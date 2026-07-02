import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import {
  Library,
  FileText,
  Type,
  Hash,
  Activity,
  Clock,
  Upload,
  X,
  Loader2,
} from "lucide-react"
import { AppShell } from "@/components/layout/AppShell"
import { PageHeader } from "@/components/blocks/PageHeader"
import { EmptyState } from "@/components/ui/empty-state"
import { StatCard } from "@/components/ui/stat-card"
import { SearchInput } from "@/components/ui/search-input"
import { Button } from "@/components/ui/button"
import { DocRow } from "@/components/blocks/DocRow"
import { kbApi } from "@/lib/api"
import type { KnowledgeDoc } from "@/types"

export function KnowledgeBasePage() {
  const navigate = useNavigate()
  const [docs, setDocs] = useState<KnowledgeDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [previewDoc, setPreviewDoc] = useState<KnowledgeDoc | null>(null)
  const [previewContent, setPreviewContent] = useState("")
  const [previewLoading, setPreviewLoading] = useState(false)

  useEffect(() => {
    kbApi.listDocuments()
      .then((res) => {
        const items = res.data || res.documents || []
        setDocs(
          items.map((d: any) => ({
            id: d.id,
            name: d.name || d.file_name || d.id,
            type: mapFileType(d),
            tags: d.tags || [],
            status: mapStatus(d),
            wordCount: d.word_count || d.wordCount || 0,
            updatedAt: d.updated_at || d.updatedAt || "—",
          }))
        )
      })
      .catch(() => setDocs([]))
      .finally(() => setLoading(false))
  }, [])

  const handleDocClick = async (doc: KnowledgeDoc) => {
    setPreviewDoc(doc)
    setPreviewContent("")
    setPreviewLoading(true)
    try {
      const res = await kbApi.getDocumentContent(doc.id)
      setPreviewContent(res.content || "")
    } catch {
      setPreviewContent("# 无法加载文档内容\n\n请稍后重试或通过对话检索。")
    } finally {
      setPreviewLoading(false)
    }
  }

  const closePreview = () => {
    setPreviewDoc(null)
    setPreviewContent("")
  }

  const kbStats = { docs: docs.length, words: docs.reduce((s, d) => s + (d.wordCount || 0), 0), status: "已连接", pending: docs.filter(d => d.status === "processing").length }

  return (
    <AppShell maxWidth={1180}>
      <PageHeader
        title="知识库管理"
        subtitle="查看索引、上传资料、处理异常文档"
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

      {/* 统计卡片 - 4 列网格 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon={FileText} label="文档" value={kbStats.docs} tone="primary" />
        <StatCard icon={Hash} label="字数" value={kbStats.words.toLocaleString()} tone="info" />
        <StatCard icon={Activity} label="状态" value={kbStats.status} tone="success" />
        <StatCard icon={Clock} label="待处理" value={kbStats.pending} tone="warning" />
      </div>

      {/* 搜索 */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex-1 max-w-md">
          <SearchInput placeholder="搜索文档..." />
        </div>
      </div>

      {/* 文档表格 */}
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
            title="知识库还是空的"
            description="添加第一份文档后，Tina 可以帮你摘要、打标签并建立知识关系。"
            primaryAction={{
              label: "添加文档",
              onClick: () => navigate("/knowledge/upload"),
            }}
            size="lg"
          />
        </div>
      ) : (
        <div className="bg-surface border border-line-soft rounded-lg shadow-xs overflow-hidden">
          {/* 表头 */}
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

      {/* ────── 文档预览弹窗 ────── */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={closePreview}>
          <div
            className="bg-surface rounded-xl border border-line-soft shadow-lg w-full max-w-[720px] max-h-[85vh] flex flex-col mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 弹窗头部 */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-line-soft">
              <div className="flex-1 min-w-0">
                <div className="text-card-title font-semibold text-ink-primary truncate">{previewDoc.name}</div>
                <div className="text-caption text-ink-tertiary mt-0.5">
                  {previewDoc.type.toUpperCase()} · {previewDoc.wordCount} 字 · {previewDoc.updatedAt}
                </div>
              </div>
              <button
                onClick={closePreview}
                className="w-8 h-8 rounded-md flex items-center justify-center text-ink-tertiary hover:text-ink-primary hover:bg-surface-soft transition-colors shrink-0"
              >
                <X className="w-5 h-5" strokeWidth={2} />
              </button>
            </div>
            {/* 弹窗内容 */}
            <div className="flex-1 overflow-y-auto scroll-thin p-5">
              {previewLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="flex items-center gap-2 text-ink-tertiary">
                    <Loader2 className="w-5 h-5 animate-spin" strokeWidth={2} />
                    <span className="text-body">加载中...</span>
                  </div>
                </div>
              ) : (
                <pre className="text-body text-ink-primary whitespace-pre-wrap font-sans leading-relaxed">
                  {previewContent}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}

function mapFileType(d: any): KnowledgeDoc["type"] {
  const name = (d.name || d.file_name || "").toLowerCase()
  if (name.endsWith(".pdf")) return "pdf"
  if (name.endsWith(".txt")) return "txt"
  if (name.endsWith(".md")) return "md"
  if (name.endsWith(".docx") || name.endsWith(".doc")) return "docx"
  return "txt"
}

function mapStatus(d: any): KnowledgeDoc["status"] {
  const s = (d.indexing_status || d.status || "").toLowerCase()
  if (s === "completed" || s === "indexed") return "indexed"
  if (s === "processing" || s === "parsing" || s === "splitting" || s === "indexing") return "processing"
  if (s === "error" || s === "failed") return "failed"
  return "pending"
}
