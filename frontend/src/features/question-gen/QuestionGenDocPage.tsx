import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import {
  ArrowLeft,
  CheckSquare,
  Download,
  FileQuestion,
  Loader2,
  Sparkles,
  Square,
  Bot,
} from "lucide-react"
import { AppShell } from "@/components/layout/AppShell"
import { PageHeader } from "@/components/blocks/PageHeader"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Badge } from "@/components/ui/badge"
import { DocumentPipelineBadge } from "@/components/blocks/DocumentPipelineBadge"
import { DocumentContentViewer } from "@/components/blocks/DocumentContentViewer"
import { kbApi, questionsApi } from "@/lib/api"
import { useKbDocuments } from "@/hooks/useKbDocuments"
import type { DocumentPage, DocumentPageDetail, PageQuestionResult } from "@/types"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { notifyCompletedTasks } from "@/lib/taskNotify"
import {
  applyStreamEvent,
  QuestionGenAgentBoard,
  type StreamLogEvent,
  type StreamLogItem,
} from "@/features/quiz/QuestionGenStreamLog"

export function QuestionGenDocPage() {
  const { documentId = "" } = useParams<{ documentId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { documents, refreshDocuments, updateDocument } = useKbDocuments({
    zoneFilter: "study",
    preferZone: "study",
  })

  const selectedDocument = documents.find((d) => d.id === documentId)

  const [pages, setPages] = useState<DocumentPage[]>([])
  const [hasPageMarkers, setHasPageMarkers] = useState(true)
  const [documentName, setDocumentName] = useState("")
  const [activePageNumber, setActivePageNumber] = useState<number | null>(null)
  const [pageDetail, setPageDetail] = useState<DocumentPageDetail | null>(null)
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set())
  const [loadingPages, setLoadingPages] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [questionsPerPage, setQuestionsPerPage] = useState(1)
  const [result, setResult] = useState<PageQuestionResult | null>(null)
  const [logItems, setLogItems] = useState<StreamLogItem[]>([])
  const [maxQuestionsPerDoc, setMaxQuestionsPerDoc] = useState(100)
  const [maxPagesPerGen, setMaxPagesPerGen] = useState(10)
  const [maxConcurrency, setMaxConcurrency] = useState(3)
  const streamEndRef = useRef<HTMLDivElement>(null)

  // 仅当用户已滚动到底部时才自动跟随（仅滚动右侧 AI 日志容器，不影响整页）
  const [userScrolled, setUserScrolled] = useState(true)
  const streamContainerRef = useRef<HTMLDivElement>(null)

  const handleStreamScroll = useCallback(() => {
    if (!streamContainerRef.current) return
    const el = streamContainerRef.current
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setUserScrolled(atBottom)
  }, [])

  useEffect(() => {
    if (working && userScrolled && streamContainerRef.current) {
      const el = streamContainerRef.current
      el.scrollTop = el.scrollHeight
    }
  }, [logItems, working, userScrolled])

  const selectedPageList = useMemo(
    () => pages.filter((p) => selectedPages.has(p.page_number)),
    [pages, selectedPages]
  )

  const hasKeySelected = selectedPageList.some((p) => p.is_key_page)
  const activePageMeta = useMemo(
    () => pages.find((p) => p.page_number === activePageNumber) || null,
    [pages, activePageNumber]
  )
  const activeQuestionCount = activePageMeta?.question_count ?? pageDetail?.question_count ?? 0

  // 每页出题上限：受单文档题目总数限制（由后端 config 下发）
  const perPageMax = selectedPages.size > 0
    ? Math.max(1, Math.floor(maxQuestionsPerDoc / selectedPages.size))
    : 5

  // 读取后端出题限制配置
  useEffect(() => {
    let cancelled = false
    kbApi
      .getConfig()
      .then((cfg: any) => {
        if (cancelled) return
        if (typeof cfg.max_questions_per_document === "number" && cfg.max_questions_per_document > 0) {
          setMaxQuestionsPerDoc(cfg.max_questions_per_document)
        }
        if (typeof cfg.max_pages_per_gen === "number" && cfg.max_pages_per_gen > 0) {
          setMaxPagesPerGen(cfg.max_pages_per_gen)
        }
        if (typeof cfg.question_gen_max_concurrency === "number" && cfg.question_gen_max_concurrency > 0) {
          setMaxConcurrency(cfg.question_gen_max_concurrency)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const handleQuestionsPerPageChange = (value: string) => {
    const n = Number(value)
    if (!Number.isFinite(n)) return
    setQuestionsPerPage(Math.min(Math.max(Math.round(n), 0), perPageMax))
  }

  const loadPages = useCallback(async (docId: string, opts?: { keepSelection?: boolean }) => {
    setLoadingPages(true)
    setError(null)
    if (!opts?.keepSelection) {
      setSelectedPages(new Set())
      setResult(null)
      setActivePageNumber(null)
      setPageDetail(null)
    }
    try {
      const res = await kbApi.getDocumentPages(docId)
      const pageList = res.pages || []
      setPages(pageList)
      setHasPageMarkers(res.has_page_markers)
      setDocumentName(res.document_name || selectedDocument?.name || "")
      if (!opts?.keepSelection && pageList.length > 0) {
        setActivePageNumber(pageList[0].page_number)
      }
    } catch (e) {
      setPages([])
      setError(e instanceof Error ? e.message : "加载页面失败")
    } finally {
      setLoadingPages(false)
    }
  }, [selectedDocument?.name])

  useEffect(() => {
    if (documentId) void loadPages(documentId)
  }, [documentId, loadPages])

  useEffect(() => {
    const raw = searchParams.get("pages")
    if (!raw || pages.length === 0) return
    const wanted = raw
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => pages.some((p) => p.page_number === n))
    if (!wanted.length) return
    setSelectedPages(new Set(wanted))
    setActivePageNumber(wanted[0])
  }, [pages, searchParams])

  useEffect(() => {
    if (!documentId || !activePageNumber) {
      setPageDetail(null)
      return
    }
    let cancelled = false
    setLoadingDetail(true)
    kbApi
      .getDocumentPage(documentId, activePageNumber)
      .then((detail) => {
        if (!cancelled) setPageDetail(detail)
      })
      .catch((e) => {
        if (!cancelled) {
          setPageDetail(null)
          setError(e instanceof Error ? e.message : "加载页内容失败")
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false)
      })
    return () => {
      cancelled = true
    }
  }, [documentId, activePageNumber])

  // 流式模式下不需要轮询，stream 完成后直接更新状态
  useEffect(() => {
    if (!documentId || !working) return
    const timer = window.setInterval(async () => {
      try {
        const docs = await refreshDocuments(true)
        const doc = docs.find((d) => d.id === documentId)
        if (!doc) return
        updateDocument(documentId, { question_gen_status: doc.question_gen_status })
      } catch {
        /* ignore */
      }
    }, 5000)
    return () => window.clearInterval(timer)
  }, [documentId, working, refreshDocuments, updateDocument])

  const togglePage = (pageNumber: number, event?: React.MouseEvent) => {
    event?.stopPropagation()
    setSelectedPages((prev) => {
      const next = new Set(prev)
      if (next.has(pageNumber)) {
        next.delete(pageNumber)
        return next
      }
      if (next.size >= maxPagesPerGen) {
        toast.warning(`单次最多选择 ${maxPagesPerGen} 页`)
        return prev
      }
      next.add(pageNumber)
      return next
    })
  }

  const handlePageClick = (pageNumber: number) => {
    setActivePageNumber(pageNumber)
  }

  const selectAll = () => {
    const nums = pages.map((p) => p.page_number)
    if (nums.length > maxPagesPerGen) {
      toast.warning(`已按上限选取前 ${maxPagesPerGen} 页`)
      setSelectedPages(new Set(nums.slice(0, maxPagesPerGen)))
      return
    }
    setSelectedPages(new Set(nums))
  }
  const clearSelection = () => setSelectedPages(new Set())

  const runGenerate = async () => {
    if (!documentId || selectedPages.size === 0) return
    setWorking(true)
    setError(null)
    setResult(null)
    setLogItems([])
    updateDocument(documentId, { question_gen_status: "processing" })

    const pageNumbers = Array.from(selectedPages).sort((a, b) => a - b).slice(0, maxPagesPerGen)

    try {
      await questionsApi.generateStream(
        {
          document_id: documentId,
          page_numbers: pageNumbers,
          questions_per_page: questionsPerPage,
        },
        (raw: any) => {
          const c = raw as StreamLogEvent
          setLogItems((prev) => applyStreamEvent(prev, c))
          if (c.event === "completed_tasks") {
            notifyCompletedTasks(raw)
          } else if (c.event === "result") {
            updateDocument(documentId, { question_gen_status: "completed" })
            const created = c.questions_created ?? 0
            setResult({
              document_id: documentId,
              page_numbers: pageNumbers,
              mode: "generate",
              question_gen_status: "completed",
              questions_created: created,
              questions_reused: 0,
              total_questions: created,
            })
            setWorking(false)
            void loadPages(documentId, { keepSelection: true })
          } else if (c.event === "error") {
            setError(c.content || "出题失败")
            setWorking(false)
            updateDocument(documentId, { question_gen_status: "failed" })
          }
        }
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : "批量出题失败"
      setError(msg)
      setLogItems((prev) => applyStreamEvent(prev, { event: "error", content: msg }))
      setWorking(false)
      updateDocument(documentId, { question_gen_status: "failed" })
    }
  }

  const displayName = selectedDocument?.name || documentName || "文档"

  const [exporting, setExporting] = useState(false)
  const handleExport = async () => {
    if (!documentId || exporting) return
    setExporting(true)
    try {
      await kbApi.exportPackage(documentId, displayName)
      toast.success("书本包已下载，可分享给其他用户导入")
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "导出失败")
    } finally {
      setExporting(false)
    }
  }

  return (
    <AppShell maxWidth={null} noPadding>
      <div className="flex flex-col h-full">
        <div className="px-8 pt-6 pb-4 border-b border-line shrink-0">
          <PageHeader
            title={displayName}
            subtitle="按页浏览内容，选择页面后由 AI 自动生成题目"
          >
            <Button
              variant="ghost"
              size="md"
              onClick={() => navigate(documentId ? `/quiz/doc/${documentId}` : "/quiz")}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              返回资料
            </Button>
            <Button variant="ghost" size="md" onClick={handleExport} disabled={exporting}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
              导出题库
            </Button>
          </PageHeader>

          {selectedDocument && (
            <div className="mt-2">
              <DocumentPipelineBadge
                segment_status={selectedDocument.segment_status}
                question_gen_status={selectedDocument.question_gen_status}
                zone={selectedDocument.zone}
              />
            </div>
          )}
        </div>

        {error && (
          <div className="mx-8 mt-4 rounded-[4px] border border-danger/30 bg-danger-soft px-4 py-2 text-caption text-danger shrink-0">
            {error}
          </div>
        )}

        {!hasPageMarkers && pages.length === 1 && (
          <div className="mx-8 mt-4 rounded-[4px] border border-line-light bg-paper-2 px-4 py-2 text-caption text-ink-soft shrink-0">
            该文档没有按页拆分，当前按全文单页出题。
          </div>
        )}

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)_320px] gap-0 overflow-hidden">
          {/* 左：页码列表 */}
          <div className="border-r border-line-light bg-paper/60 flex flex-col min-h-0 overflow-hidden">
            <div className="px-3 py-3 border-b border-line-light flex items-center justify-between shrink-0">
              <span className="text-small font-medium text-ink">页码</span>
              {pages.length > 0 && (
                <div className="flex gap-1">
                  <button type="button" onClick={selectAll} className="text-caption text-sea hover:underline">全选</button>
                  <span className="text-caption text-ink-disabled">·</span>
                  <button type="button" onClick={clearSelection} className="text-caption text-ink-disabled hover:underline">清空</button>
                </div>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto scroll-thin p-2">
              {loadingPages ? (
                <div className="flex items-center justify-center py-8 text-ink-disabled">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  加载中…
                </div>
              ) : pages.length === 0 ? (
                <div className="text-caption text-ink-disabled text-center py-8">暂无页面</div>
              ) : (
                pages.map((page) => {
                  const isActive = activePageNumber === page.page_number
                  const isSelected = selectedPages.has(page.page_number)
                  return (
                    <div
                      key={page.page_number}
                      className={cn(
                        "rounded-[4px] mb-0.5 transition-colors flex items-start gap-1",
                        isActive && "bg-sea-subtle"
                      )}
                    >
                      <button
                        type="button"
                        onClick={(e) => togglePage(page.page_number, e)}
                        className="shrink-0 px-2 py-2.5 text-ink-disabled hover:text-sea"
                        title={isSelected ? "取消选中" : "选中此页"}
                      >
                        {isSelected ? (
                          <CheckSquare className="h-4 w-4 text-sea" />
                        ) : (
                          <Square className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePageClick(page.page_number)}
                        className={cn(
                          "flex-1 min-w-0 text-left px-1 py-2.5 text-small transition-colors",
                          isActive ? "text-ink font-medium" : "text-ink-soft hover:bg-paper-2"
                        )}
                      >
                        <div className="truncate">{page.title}</div>
                        {(page.question_count || 0) > 0 && (
                          <div className="text-caption text-sea mt-0.5">
                            已出题 {page.question_count}
                          </div>
                        )}
                        {(page.has_builtin_questions || page.is_key_page) && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {page.has_builtin_questions && <Badge variant="neutral" size="sm">含习题</Badge>}
                            {page.is_key_page && <Badge variant="primary" size="sm">重点</Badge>}
                          </div>
                        )}
                        {page.preview && (
                          <div className="text-caption text-ink-disabled truncate mt-0.5">{page.preview}</div>
                        )}
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* 中：页内容预览 */}
          <div className="flex flex-col min-h-0 overflow-hidden bg-paper">
            <div className="px-5 py-3 border-b border-line-light shrink-0">
              <span className="text-body font-medium text-ink">
                {pageDetail?.title || (activePageNumber ? `第 ${activePageNumber} 页` : "页内容预览")}
              </span>
              {pageDetail && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {activeQuestionCount > 0 && (
                    <Badge variant="primary" size="sm">已出题 {activeQuestionCount}</Badge>
                  )}
                  {pageDetail.has_builtin_questions && <Badge variant="neutral" size="sm">含习题</Badge>}
                  {pageDetail.is_key_page && <Badge variant="primary" size="sm">重点</Badge>}
                </div>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto scroll-thin p-5">
              {loadingDetail ? (
                <div className="flex items-center justify-center py-16 text-ink-disabled">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  加载页内容…
                </div>
              ) : !pageDetail ? (
                <EmptyState
                  icon={FileQuestion}
                  title="选择一页查看内容"
                  description="从左侧页码列表点击页面"
                  size="md"
                />
              ) : (
                <DocumentContentViewer
                  docId={documentId}
                  previewMode="markdown"
                  content={pageDetail.content || ""}
                />
              )}
            </div>
          </div>

          {/* 右：出题操作 + AI 推理过程 */}
          <div className="border-l border-line-light bg-paper/60 flex flex-col min-h-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-line-light shrink-0">
              <h3 className="font-display text-title-s text-ink">出题</h3>
            </div>
            <div className="flex flex-col gap-3 p-4 shrink-0 border-b border-line-light">
              <p className="text-caption text-ink-soft">
                在左侧勾选要出题的页面。已选{" "}
                <span className="font-medium text-ink">{selectedPages.size}</span> 页
                {selectedPages.size > 0 && (
                  questionsPerPage === 0 ? (
                    <>，每页题数由 Agent 按内容自行决定</>
                  ) : (
                    <>，本次最多出{" "}
                      <span className="font-medium text-ink">
                        {selectedPages.size * questionsPerPage}
                      </span>{" "}
                      题
                    </>
                  )
                )}
              </p>

              {selectedPages.size > 0 && (
                <div className="text-caption text-ink-disabled space-y-1">
                  {hasKeySelected && <p>· 选中页含重点内容</p>}
                  <p>· 单次最多选择 {maxPagesPerGen} 页</p>
                  <p>· 每页一个 Agent，最多同时跑 {maxConcurrency} 路</p>
                  <div className="flex items-center gap-2 pt-2">
                    <label className="text-caption text-ink-soft shrink-0">每页出题：</label>
                    <input
                      type="number"
                      min={0}
                      max={perPageMax}
                      value={questionsPerPage}
                      onChange={(e) => handleQuestionsPerPageChange(e.target.value)}
                      disabled={working}
                      className="flex-1 rounded-[4px] border border-line-light bg-paper px-2 py-1 text-small text-ink outline-none focus:border-sea"
                    />
                    <span className="text-caption text-ink-disabled shrink-0">道/页</span>
                  </div>
                  {questionsPerPage === 0 ? (
                    <p>填 0 表示不限制每页题数，由 Agent 根据页面内容自行发挥（单文档上限 {maxQuestionsPerDoc} 题）。</p>
                  ) : (
                    <p>
                      共 {selectedPages.size} 页 × {questionsPerPage} 道 ={" "}
                      <span className="font-medium text-ink">
                        {selectedPages.size * questionsPerPage}
                      </span>{" "}
                      题（单文档上限 {maxQuestionsPerDoc} 题，每页最多 {perPageMax} 道）
                    </p>
                  )}
                </div>
              )}

              <Button
                className="w-full"
                size="md"
                disabled={working || selectedPages.size === 0}
                onClick={runGenerate}
              >
                {working ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                AI 批量出题
              </Button>

              {result && !working && (
                <div className="rounded-[4px] border border-sea-subtle bg-sea-subtle px-3 py-2 text-caption text-ink">
                  <span>生成完成：</span>
                  {result.total_questions > 0 ? (
                    <>
                      新建 {result.questions_created} 题，共 {result.total_questions} 题。
                      <Link to={`/quiz/doc/${result.document_id}`} className="ml-1 text-sea hover:underline">回这本书</Link>
                    </>
                  ) : (
                    "未生成题目"
                  )}
                </div>
              )}
            </div>

            {/* AI 推理日志区域 — 固定高度，内容自适应滚动 */}
            <div
              ref={streamContainerRef}
              onScroll={handleStreamScroll}
              className="flex-1 min-h-0 overflow-y-auto scroll-thin bg-paper-2 p-4"
              style={{ maxHeight: "calc(100dvh - 280px)" }}
            >
              {working && (
                <div className="flex items-center gap-1.5 mb-3 shrink-0">
                  <Bot className="w-3.5 h-3.5 text-sea" strokeWidth={2} />
                  <span className="text-caption font-medium text-sea">AI 正在出题</span>
                  <Loader2 className="w-3 h-3 animate-spin text-sea" />
                </div>
              )}
              {logItems.length === 0 && !working && (
                <div className="text-caption text-ink-disabled text-center py-8">点击「AI 批量出题」开始生成</div>
              )}
              {logItems.length === 0 && working && (
                <div className="text-caption text-ink-disabled">等待 Agent 输出…</div>
              )}
              <QuestionGenAgentBoard items={logItems} finished={!working} layout="stack" />
              <div ref={streamEndRef} />
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}