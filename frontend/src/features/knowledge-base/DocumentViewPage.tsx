import { useEffect, useState } from "react"
import { ArrowLeft, Loader2 } from "lucide-react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { AppShell } from "@/components/layout/AppShell"
import { PageHeader } from "@/components/blocks/PageHeader"
import { Button } from "@/components/ui/button"
import { renderHighlightedContent } from "@/components/blocks/DocumentPreviewModal"
import { kbApi } from "@/lib/api"

export function DocumentViewPage() {
  const { docId = "" } = useParams<{ docId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const titleParam = searchParams.get("title")
  const charStart = parseOptionalInt(searchParams.get("start"))
  const charEnd = parseOptionalInt(searchParams.get("end"))

  const [fileName, setFileName] = useState(titleParam || "文档")
  const [content, setContent] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!docId) return
    setLoading(true)
    setError(null)
    kbApi
      .getDocumentContent(docId)
      .then((res) => {
        setFileName(res.file_name || titleParam || "文档")
        setContent(res.content || "")
      })
      .catch((err: Error) => setError(err.message || "加载失败"))
      .finally(() => setLoading(false))
  }, [docId, titleParam])

  return (
    <AppShell maxWidth={960}>
      <PageHeader title={fileName} subtitle="文档全文预览">
        <Button variant="ghost" size="md" onClick={() => navigate("/knowledge")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回知识库
        </Button>
      </PageHeader>

      {charStart != null && charEnd != null && (
        <div className="text-caption text-ink-tertiary mb-4">
          高亮位置 {charStart}–{charEnd}
        </div>
      )}

      <div className="bg-surface border border-line-soft rounded-lg shadow-xs min-h-[480px]">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="flex items-center gap-2 text-ink-tertiary">
              <Loader2 className="w-5 h-5 animate-spin" strokeWidth={2} />
              <span className="text-body">加载中...</span>
            </div>
          </div>
        ) : error ? (
          <div className="p-8 text-body text-danger">{error}</div>
        ) : (
          <pre className="p-8 text-body text-ink-primary whitespace-pre-wrap font-sans leading-relaxed">
            {renderHighlightedContent(content, charStart, charEnd)}
          </pre>
        )}
      </div>
    </AppShell>
  )
}

function parseOptionalInt(value: string | null): number | null {
  if (value == null || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
