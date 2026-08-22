import { useEffect, useState } from "react"
import { ArrowLeft, Download, Loader2, AlertTriangle } from "lucide-react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { AppShell } from "@/components/layout/AppShell"
import { PageHeader } from "@/components/blocks/PageHeader"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { DocumentContentViewer } from "@/components/blocks/DocumentContentViewer"
import { kbApi } from "@/lib/api"
import { toast } from "sonner"
import type { DocumentContentMeta } from "@/types"

export function DocumentViewPage() {
  const { docId = "" } = useParams<{ docId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const titleParam = searchParams.get("title")
  const charStart = parseOptionalInt(searchParams.get("start"))
  const charEnd = parseOptionalInt(searchParams.get("end"))

  const [meta, setMeta] = useState<DocumentContentMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    if (!docId || exporting) return
    setExporting(true)
    try {
      await kbApi.exportPackage(docId, fileName)
      toast.success("书本包已下载，可分享给其他用户导入")
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "导出失败")
    } finally {
      setExporting(false)
    }
  }

  useEffect(() => {
    if (!docId) return
    setLoading(true)
    setError(null)
    kbApi
      .getDocumentContent(docId)
      .then((res) => setMeta(res))
      .catch((err: Error) => setError(err.message || "加载失败"))
      .finally(() => setLoading(false))
  }, [docId])

  const fileName = meta?.file_name || titleParam || "文档"
  const previewMode =
    meta?.preview_mode === "pdf" && meta?.has_raw_file
      ? "pdf"
      : meta?.preview_mode === "markdown" || meta?.file_type === "md" || meta?.file_type === "pdf" || meta?.file_type === "docx"
        ? "markdown"
        : "text"

  return (
    <AppShell maxWidth={previewMode === "pdf" ? null : 960}>
      <PageHeader title={fileName} subtitle="文档全文预览">
        <Button variant="secondary" size="md" onClick={handleExport} disabled={exporting}>
          {exporting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
          导出书本+题库
        </Button>
        <Button variant="ghost" size="md" onClick={() => navigate("/quiz")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回资料
        </Button>
      </PageHeader>

      {meta?.warning && (
        <Alert className="mb-4 border-warning/30 bg-warning-soft text-ink-primary">
          <AlertTriangle className="text-warning" />
          <AlertDescription>{meta.warning}</AlertDescription>
        </Alert>
      )}

      {charStart != null && charEnd != null && previewMode !== "pdf" && (
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
          <div className={previewMode === "pdf" ? "p-2" : "p-8"}>
            <DocumentContentViewer
              docId={docId}
              previewMode={previewMode}
              content={meta?.content || ""}
              charStart={charStart}
              charEnd={charEnd}
            />
          </div>
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
