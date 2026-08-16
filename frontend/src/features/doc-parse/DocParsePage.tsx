import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  UploadCloud,
  Loader2,
  FileText,
  Download,
  LibraryBig,
  Eye,
  PenLine,
  CheckCircle2,
  AlertTriangle,
  X,
} from "lucide-react"
import { AppShell } from "@/components/layout/AppShell"
import { PageHeader } from "@/components/blocks/PageHeader"
import { Button } from "@/components/ui/button"
import { MarkdownWithMath } from "@/components/blocks/MarkdownWithMath"
import { cn } from "@/lib/utils"
import { docParseApi, type DocParsePreview } from "@/lib/api"
import { toast } from "sonner"
import {
  clearDocParseSession,
  loadDocParseSession,
  saveDocParseSession,
  type EditablePage,
} from "./docParseSession"

function formatPageTitle(page: number) {
  return `## 第 ${page} 页`
}

export function DocParsePage() {
  const [preview, setPreview] = useState<DocParsePreview | null>(null)
  const [pages, setPages] = useState<EditablePage[]>([])
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [editing, setEditing] = useState<Record<number, boolean>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 挂载时恢复上次会话（切换路由后再回来，解析结果与编辑状态仍在）
  useEffect(() => {
    const session = loadDocParseSession()
    if (session) {
      setPreview(session.preview)
      setPages(session.pages)
      setEditing(session.editing)
    }
  }, [])

  // 状态变化时保存会话（内存优先，sessionStorage 尽力而为）
  useEffect(() => {
    if (!preview) return
    saveDocParseSession({ preview, pages, editing })
  }, [preview, pages, editing])

  const hasResult = preview !== null

  const handleFile = useCallback(async (file: File) => {
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
      toast.error("请选择 PDF 文件")
      return
    }
    setParseError(null)
    setParsing(true)
    try {
      const data = await docParseApi.preview(file)
      setPreview(data)
      // 预览用 data URI 显示图片；导入时由后端把 images/xxx 相对路径落盘
      const resolveImage = (text: string) => {
        let t = text ?? ""
        for (const [name, uri] of Object.entries(data.images || {})) {
          t = t.split(`images/${name}`).join(uri)
        }
        return t
      }
      setPages(
        data.pages.map((p) => ({
          page: p.page,
          text: resolveImage(p.text),
          saved: resolveImage(p.text),
          dirty: false,
        }))
      )
      toast.success(`解析完成：共 ${data.total_pages} 页`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "解析失败"
      setParseError(msg)
      setPreview(null)
      setPages([])
      toast.error(msg)
    } finally {
      setParsing(false)
    }
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files?.[0]
      if (file) void handleFile(file)
    },
    [handleFile]
  )

  const updatePage = useCallback((page: number, text: string) => {
    setPages((prev) =>
      prev.map((p) => (p.page === page ? { ...p, text, dirty: text !== p.saved } : p))
    )
  }, [])

  const toggleEdit = useCallback((page: number) => {
    setEditing((prev) => ({ ...prev, [page]: !prev[page] }))
  }, [])

  const editedMarkdown = useMemo(() => {
    if (!preview) return ""
    // 导入时把 data URI 还原为相对路径 images/xxx（后端据此落盘并转标记）
    const restoreImage = (text: string) => {
      let t = text ?? ""
      for (const [name, uri] of Object.entries(preview.images || {})) {
        t = t.split(uri).join(`images/${name}`)
      }
      return t
    }
    const parts: string[] = [`# ${preview.filename}`, "", `> 共 ${pages.length} 页`]
    for (const p of pages) {
      const body = restoreImage(p.text).trim()
      parts.push(formatPageTitle(p.page), "", body || "（本页无内容）")
    }
    return parts.join("\n") + "\n"
  }, [preview, pages])

  const exportMd = useCallback(() => {
    const blob = new Blob([editedMarkdown], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    const name = preview?.filename?.replace(/\.pdf$/i, "") || "document"
    a.href = url
    a.download = `${name}-解析.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [editedMarkdown, preview])

  const importToKb = useCallback(async () => {
    if (!preview) return
    setImporting(true)
    try {
      const name = preview.filename.replace(/\.pdf$/i, "") + ".md"
      const images = preview.images && Object.keys(preview.images).length > 0
        ? preview.images
        : undefined
      const res = await docParseApi.importMarkdown(editedMarkdown, name, undefined, images)
      toast.success(res.status === "duplicate" ? "内容已存在，未重复导入" : "已导入知识库")
    } catch (e) {
      const msg = e instanceof Error ? e.message : "导入失败"
      toast.error(msg)
    } finally {
      setImporting(false)
    }
  }, [preview, editedMarkdown])

  const dirtyCount = pages.filter((p) => p.dirty).length

  return (
    <AppShell>
      <div className="max-w-[1400px] mx-auto px-6 py-6">
        <PageHeader
          title="扫描件解析"
          subtitle="上传扫描 PDF → MinerU 解析 → 逐页校对后一键导入知识库（不会自动入库）"
        />

        {!hasResult && (
          <div className="space-y-6">
            {/* 上传区 */}
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "border-2 border-dashed rounded-lg p-12 text-center transition-all cursor-pointer",
                "border-line bg-surface hover:border-primary/40 hover:bg-surface-soft/50"
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleFile(f)
                  e.target.value = ""
                }}
              />
              {parsing ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                  <div className="text-card-title font-semibold text-ink-primary">正在用 MinerU 解析…</div>
                  <div className="text-caption text-ink-tertiary">扫描 PDF 首次解析需加载模型，可能要几分钟</div>
                </div>
              ) : (
                <>
                  <div className="w-16 h-16 rounded-xl bg-primary-soft text-primary flex items-center justify-center mx-auto mb-4">
                    <UploadCloud className="w-8 h-8" strokeWidth={2} />
                  </div>
                  <div className="text-card-title font-semibold text-ink-primary mb-1">
                    拖拽扫描 PDF 到这里，或点击选择文件
                  </div>
                  <div className="text-caption text-ink-tertiary">
                    仅解析预览，不写入知识库；带版面的 Markdown + 公式还原
                  </div>
                </>
              )}
            </div>

            {parseError && (
              <div className="flex items-start gap-2 p-4 rounded-md bg-danger/10 text-danger text-body">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium">解析失败</div>
                  <div className="text-caption mt-0.5 break-all">{parseError}</div>
                </div>
              </div>
            )}
          </div>
        )}

        {hasResult && preview && (
          <div className="space-y-4">
            {/* 顶部操作栏 */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-ink-tertiary shrink-0" />
                <span className="text-body text-ink-primary truncate">{preview.filename}</span>
                <span className="text-caption text-ink-tertiary shrink-0">{pages.length} 页</span>
                {dirtyCount > 0 && (
                  <span className="text-caption text-warning shrink-0">{dirtyCount} 页已修改</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={exportMd}>
                  <Download className="w-4 h-4" />导出 md
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={importToKb}
                  disabled={importing}
                >
                  {importing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <LibraryBig className="w-4 h-4" />
                  )}
                  导入至知识库
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    clearDocParseSession()
                    setPreview(null)
                    setPages([])
                    setEditing({})
                  }}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* 解析结果（逐页，编辑/预览切换） */}
            <div className="space-y-3">
              {pages.map((p) => {
                  const isEdit = !!editing[p.page]
                  return (
                    <div key={p.page} className="rounded-lg border border-line bg-surface-soft/40">
                      <div className="flex items-center justify-between px-3 py-2 border-b border-line-soft">
                        <span className="text-caption font-medium text-ink-primary">第 {p.page} 页</span>
                        <div className="flex items-center gap-1.5">
                          {p.dirty && (
                            <span className="text-caption text-warning flex items-center gap-1">
                              <PenLine className="w-3 h-3" />已编辑
                            </span>
                          )}
                          <Button variant={isEdit ? "secondary" : "ghost"} size="sm" onClick={() => toggleEdit(p.page)}>
                            {isEdit ? (
                              <>
                                <Eye className="w-3.5 h-3.5" />预览
                              </>
                            ) : (
                              <>
                                <PenLine className="w-3.5 h-3.5" />编辑
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                      <div className="p-3">
                        {isEdit ? (
                          <textarea
                            value={p.text}
                            onChange={(e) => updatePage(p.page, e.target.value)}
                            className="w-full min-h-[260px] font-mono text-small bg-surface rounded-md border border-line p-3 focus:outline-none focus:border-sea resize-y leading-relaxed"
                            spellCheck={false}
                          />
                        ) : p.text.trim() ? (
                          <div className="max-h-[420px] overflow-y-auto pr-1">
                            <MarkdownWithMath>{p.text}</MarkdownWithMath>
                          </div>
                        ) : (
                          <div className="text-caption text-ink-disabled py-6 text-center">（本页未识别到内容）</div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

            {/* 底部提示 */}
            <div className="flex items-center gap-2 text-caption text-ink-tertiary pt-2">
              <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
              {dirtyCount > 0
                ? `有 ${dirtyCount} 页已手动修改，点击「导入至知识库」将按当前内容入库`
                : `可直接点击「导入至知识库」，将按 MinerU 原始结果入库（保留分页结构）`}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
