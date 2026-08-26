import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import {
  ArrowLeft,
  Bookmark,
  Bot,
  FileText,
  Loader2,
  Maximize,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
} from "lucide-react"
import { AppShell } from "@/components/layout/AppShell"
import { Badge } from "@/components/ui/badge"
import { kbApi, notesApi } from "@/lib/api"
import {
  getMarkedPages,
  getProgress,
  isPageMarked,
  setProgress,
  toggleMarkedPage,
} from "@/lib/companionStore"
import { cn } from "@/lib/utils"
import type { DocumentContentMeta, DocumentPage, DocumentPageDetail } from "@/types"
import { ReadingAssistSidebar, type AssistTab } from "./ReadingAssistSidebar"
import { ReadingDocumentPane, type ReadingViewMode } from "./ReadingDocumentPane"
import { toast } from "sonner"

function resolveNativeMode(meta: DocumentContentMeta | null): ReadingViewMode {
  if (!meta) return "markdown"
  const mode = meta.preview_mode
  if (mode === "pdf" || mode === "docx" || mode === "markdown" || mode === "text") return mode
  const ft = (meta.file_type || "").toLowerCase()
  if (ft === "pdf" && meta.is_scanned_pdf) return "markdown"
  if (ft === "pdf" && meta.has_raw_file) return "pdf"
  if (ft === "docx" && meta.has_raw_file) return "docx"
  if (ft === "md") return "markdown"
  return "markdown"
}

export function CompanionReadPage() {
  const { docId = "" } = useParams<{ docId: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const pageFromUrl = Number(searchParams.get("page"))

  const [pageList, setPageList] = useState<DocumentPage[]>([])
  const [contentMeta, setContentMeta] = useState<DocumentContentMeta | null>(null)
  const [loadingPages, setLoadingPages] = useState(true)
  const [activePage, setActivePage] = useState<number | null>(null)
  const [pageDetail, setPageDetail] = useState<DocumentPageDetail | null>(null)
  const [railOpen, setRailOpen] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [assistOpen, setAssistOpen] = useState(false)
  const [assistTab, setAssistTab] = useState<AssistTab>("ai")
  const [preferParsed, setPreferParsed] = useState(false)
  const [tipRefreshKey, setTipRefreshKey] = useState(0)
  const [, setRevision] = useState(0)
  const markedPages = getMarkedPages(docId)

  const scrollRef = useRef<HTMLDivElement>(null)
  const activePageRef = useRef<number | null>(null)
  const resumedRef = useRef(false)

  const nativeMode = resolveNativeMode(contentMeta)
  const viewMode: ReadingViewMode =
    preferParsed && (nativeMode === "pdf" || nativeMode === "docx") ? "markdown" : nativeMode
  const showToc = viewMode === "markdown" || viewMode === "text"
  const canToggleParsed = nativeMode === "pdf" || nativeMode === "docx"
  const docName = contentMeta?.file_name || "文档"

  useEffect(() => {
    const prev = document.title
    const name = (docName || "阅读").trim()
    document.title = `${name} · 知拾`
    const bust = `logo.png?v=3&t=${Date.now()}`
    const ensureIcon = (rel: string, type?: string) => {
      let link = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null
      if (!link) {
        link = document.createElement("link")
        link.rel = rel
        document.head.appendChild(link)
      }
      if (type) link.type = type
      link.href = `${import.meta.env.BASE_URL}${bust}`
    }
    ensureIcon("icon", "image/png")
    ensureIcon("apple-touch-icon")
    return () => {
      document.title = prev
    }
  }, [docName])

  useEffect(() => {
    if (!docId) return
    let cancelled = false
    setLoadingPages(true)
    resumedRef.current = false
    setPreferParsed(false)
    Promise.all([
      kbApi.getDocumentPages(docId),
      kbApi.getDocumentContent(docId, { metaOnly: true }).catch(() => null),
    ])
      .then(([res, content]) => {
        if (cancelled) return
        const pages = res.pages || []
        setPageList(pages)
        // 阅读按页拉取正文，不在前端持有全书 parsed.md
        setContentMeta(content ? { ...content, content: "" } : null)
        if (pages.length > 0) {
          const saved = getProgress(docId)
          const target =
            saved != null && pages.some((p) => p.page_number === saved)
              ? saved
              : pages[0].page_number
          activePageRef.current = target
          setActivePage(target)
        }
      })
      .catch(() => {
        setPageList([])
        setContentMeta(null)
      })
      .finally(() => {
        if (!cancelled) setLoadingPages(false)
      })
    return () => {
      cancelled = true
    }
  }, [docId])

  useEffect(() => {
    if (!docId || !activePage || !showToc) return
    let cancelled = false
    kbApi
      .getDocumentPage(docId, activePage)
      .then((detail) => {
        if (!cancelled) setPageDetail(detail)
      })
      .catch(() => {
        if (!cancelled) setPageDetail(null)
      })
    return () => {
      cancelled = true
    }
  }, [docId, activePage, showToc])

  useEffect(() => {
    if (docId && activePage != null) setProgress(docId, activePage)
  }, [docId, activePage])

  useEffect(() => {
    activePageRef.current = activePage
  }, [activePage])

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", onFs)
    return () => document.removeEventListener("fullscreenchange", onFs)
  }, [])

  const totalPages = pageList.length
  const currentMarked = activePage != null && markedPages.includes(activePage)

  const handleScroll = useCallback(() => {
    const container = scrollRef.current
    if (!container || !showToc) return
    const refY = container.scrollTop + container.clientHeight * 0.35
    let current: number | null = null
    const sections = container.querySelectorAll<HTMLElement>("[data-page]")
    for (const s of sections) {
      const n = Number(s.dataset.page)
      if (!Number.isFinite(n)) continue
      if (s.offsetTop <= refY) current = n
      else break
    }
    if (current != null && current !== activePageRef.current) {
      activePageRef.current = current
      setActivePage(current)
    }
  }, [showToc])

  const scrollToPage = useCallback((n: number, smooth = true) => {
    const container = scrollRef.current
    if (!container) return
    const section = container.querySelector<HTMLElement>(`[data-page="${n}"]`)
    if (section) {
      container.scrollTo({ top: section.offsetTop - 8, behavior: smooth ? "smooth" : "auto" })
    }
  }, [])

  useEffect(() => {
    if (!showToc || resumedRef.current) return
    let tries = 0
    const timer = window.setInterval(() => {
      tries++
      const container = scrollRef.current
      const saved = getProgress(docId)
      const fromUrl =
        Number.isFinite(pageFromUrl) && pageList.some((p) => p.page_number === pageFromUrl)
          ? pageFromUrl
          : null
      const target =
        fromUrl ??
        (saved != null && pageList.some((p) => p.page_number === saved)
          ? saved
          : pageList[0]?.page_number)
      if (container && target != null) {
        const section = container.querySelector<HTMLElement>(`[data-page="${target}"]`)
        if (section) {
          container.scrollTop = section.offsetTop - 8
          resumedRef.current = true
          window.clearInterval(timer)
          return
        }
      }
      if (tries > 40) window.clearInterval(timer)
    }, 100)
    return () => window.clearInterval(timer)
  }, [docId, pageList, pageFromUrl, showToc])

  const toggleMark = useCallback(() => {
    if (!docId || activePage == null) return
    const next = toggleMarkedPage(docId, activePage)
    setRevision((r) => r + 1)
    toast.success(next.includes(activePage) ? "已标记为重点页" : "已取消重点标记")
  }, [docId, activePage])

  const handleSaveTip = useCallback(
    async (content: string, title?: string) => {
      if (!docId) return
      try {
        await notesApi.saveTip({
          document_id: docId,
          page_number: activePage,
          title: title?.trim() || (activePage != null ? `第 ${activePage} 页摘录` : "摘录"),
          content,
        })
        toast.success(`已 tip 到《${docName}》`)
        setTipRefreshKey((k) => k + 1)
      } catch {
        toast.error("保存笔记失败，请检查服务器连接")
      }
    },
    [docId, activePage, docName]
  )

  const openAssist = (tab: AssistTab) => {
    if (assistOpen && assistTab === tab) {
      setAssistOpen(false)
      return
    }
    setAssistTab(tab)
    setAssistOpen(true)
  }

  const enterFullscreen = () => {
    document.documentElement.requestFullscreen?.().catch(() => {})
    setFullscreen(true)
  }
  const exitFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    setFullscreen(false)
  }

  const modeLabel =
    viewMode === "pdf"
      ? "原 PDF"
      : viewMode === "docx"
        ? "原 DOCX"
        : contentMeta?.is_scanned_pdf
          ? "扫描件 · 解析稿"
          : preferParsed
            ? "解析稿"
            : "Markdown"

  const warningBanner =
    viewMode === "pdf" ? (
      <div className="shrink-0 px-4 py-2 border-b border-line-light bg-warning-soft/60 text-caption text-ink-soft flex items-center gap-3 flex-wrap">
        <span>原 PDF 内无法划选或点选图片 tip。需要 tip 请切到解析稿。</span>
        {canToggleParsed && (
          <button
            type="button"
            className="text-sea font-medium hover:underline"
            onClick={() => setPreferParsed(true)}
          >
            打开解析稿
          </button>
        )}
      </div>
    ) : preferParsed && canToggleParsed ? (
      <div className="shrink-0 px-4 py-2 border-b border-line-light bg-sea-subtle/50 text-caption text-ink-soft flex items-center gap-3 flex-wrap">
        <span>当前为解析稿，可划选文字或点选插图收入 tip。</span>
        <button
          type="button"
          className="text-sea font-medium hover:underline"
          onClick={() => setPreferParsed(false)}
        >
          返回原{nativeMode === "pdf" ? " PDF" : " DOCX"}
        </button>
      </div>
    ) : contentMeta?.is_scanned_pdf ? (
      <div className="shrink-0 px-4 py-2 border-b border-line-light bg-sea-subtle/50 text-caption text-ink-soft">
        扫描件已打开智能解析稿（MD），可划选文字或点选插图 tip。
      </div>
    ) : null

  const assistSidebar = (
    <ReadingAssistSidebar
      docId={docId}
      docName={docName}
      pageNumber={activePage}
      pageContent={pageDetail?.content || ""}
      open={assistOpen}
      tab={assistTab}
      onOpenChange={setAssistOpen}
      onTabChange={setAssistTab}
      onSaveTip={handleSaveTip}
      onJumpToPage={(n) => {
        if (!showToc) {
          setPreferParsed(true)
          window.setTimeout(() => scrollToPage(n), 80)
          return
        }
        scrollToPage(n)
      }}
      tipRefreshKey={tipRefreshKey}
    />
  )

  const toolbarButtons = (
    <>
      {showToc && (
        <button
          type="button"
          onClick={toggleMark}
          disabled={activePage == null}
          className={cn(
            "inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-small font-medium transition-colors shrink-0",
            currentMarked ? "bg-sea-subtle text-sea" : "text-ink-soft hover:bg-paper-2 hover:text-sea"
          )}
        >
          <Bookmark className={cn("w-4 h-4", currentMarked && "fill-current")} strokeWidth={2} />
          标为重点
        </button>
      )}
      <button
        type="button"
        onClick={() => openAssist("ai")}
        className={cn(
          "w-9 h-9 rounded-md flex items-center justify-center transition-colors shrink-0",
          assistOpen && assistTab === "ai"
            ? "text-sea bg-sea-subtle"
            : "text-ink-disabled hover:bg-paper-2 hover:text-ink"
        )}
        aria-label="打开 AI 对话"
        title="AI 对话"
      >
        <Bot className="w-4 h-4" strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={() => openAssist("tip")}
        className={cn(
          "w-9 h-9 rounded-md flex items-center justify-center transition-colors shrink-0",
          assistOpen && assistTab === "tip"
            ? "text-sea bg-sea-subtle"
            : "text-ink-disabled hover:bg-paper-2 hover:text-ink"
        )}
        aria-label="打开 Tip"
        title="本资料 Tip"
      >
        <FileText className="w-4 h-4" strokeWidth={2} />
      </button>
    </>
  )

  const mainReader = (
    <div
      className="flex-1 flex flex-col min-w-0 [&_img[data-tip-image]]:cursor-pointer [&_img[data-tip-image]]:hover:ring-2 [&_img[data-tip-image]]:hover:ring-sea/30"
      data-tip-doc={docId}
      data-tip-doc-name={docName}
    >
      <div className="h-14 shrink-0 border-b border-line-light bg-paper flex items-center gap-2 px-4">
        {showToc && !railOpen && !fullscreen && (
          <button
            type="button"
            onClick={() => setRailOpen(true)}
            className="w-9 h-9 rounded-md flex items-center justify-center text-ink-disabled hover:text-ink hover:bg-paper-2 transition-colors shrink-0"
            aria-label="展开目录"
          >
            <PanelLeftOpen className="w-4 h-4" strokeWidth={2} />
          </button>
        )}
        {!fullscreen && (
          <button
            type="button"
            onClick={() => navigate(docId ? `/quiz/doc/${docId}` : "/quiz")}
            className="w-9 h-9 rounded-md flex items-center justify-center text-ink-disabled hover:text-ink hover:bg-paper-2 transition-colors shrink-0"
            aria-label="返回资料"
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={2} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-small font-semibold text-ink truncate leading-tight">{docName}</div>
          <div className="text-caption text-ink-disabled leading-tight">
            {modeLabel}
            {showToc && totalPages
              ? ` · 第 ${activePage ?? "—"} / ${totalPages} 页`
              : ""}
          </div>
        </div>
        {toolbarButtons}
        {!fullscreen ? (
          <button
            type="button"
            onClick={enterFullscreen}
            className="w-9 h-9 rounded-md flex items-center justify-center text-ink-disabled hover:text-ink hover:bg-paper-2 transition-colors shrink-0"
            aria-label="全屏阅读"
            title="全屏阅读"
          >
            <Maximize className="w-4 h-4" strokeWidth={2} />
          </button>
        ) : (
          <button
            type="button"
            onClick={exitFullscreen}
            className="w-9 h-9 rounded-md flex items-center justify-center text-ink-disabled hover:text-ink hover:bg-paper-2 transition-colors shrink-0"
            aria-label="退出全屏"
          >
            <Minimize2 className="w-4 h-4" strokeWidth={2} />
          </button>
        )}
      </div>

      {warningBanner}

      {viewMode === "pdf" ? (
        <div className="relative flex-1 min-h-0 p-2 bg-paper-2">
          <ReadingDocumentPane
            docId={docId}
            viewMode="pdf"
            pageList={pageList}
            loading={loadingPages}
            className="h-full"
            activePage={activePage}
          />
        </div>
      ) : (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="relative flex-1 overflow-y-auto scroll-thin p-6 md:p-8 bg-paper"
        >
          {loadingPages ? (
            <div className="flex items-center justify-center py-24 text-ink-disabled gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>加载文档…</span>
            </div>
          ) : (
            <ReadingDocumentPane
              docId={docId}
              viewMode={viewMode}
              pageList={showToc ? pageList : []}
              loading={false}
              scrollRootRef={scrollRef}
              activePage={activePage}
            />
          )}
          <div className="h-24" />
        </div>
      )}
    </div>
  )

  if (fullscreen) {
    return (
      <div className="h-dvh bg-paper flex relative">
        {mainReader}
        {assistSidebar}
      </div>
    )
  }

  return (
    <AppShell maxWidth={null} noPadding>
      <div className="flex h-full min-h-0">
        {showToc && (
          <aside
            className={cn(
              "shrink-0 border-r border-line-light bg-paper flex flex-col transition-all duration-200 overflow-hidden",
              railOpen ? "w-56" : "w-0"
            )}
          >
            <div className="flex items-center justify-between px-3 h-12 border-b border-line-light shrink-0">
              <span className="text-small font-medium text-ink">目录</span>
              <button
                type="button"
                onClick={() => setRailOpen(false)}
                className="w-8 h-8 rounded-md flex items-center justify-center text-ink-disabled hover:text-ink hover:bg-paper-2 transition-colors"
                aria-label="收起目录"
              >
                <PanelLeftClose className="w-4 h-4" strokeWidth={2} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto scroll-thin p-2">
              {pageList.length === 0 ? (
                <div className="text-caption text-ink-disabled text-center py-8">暂无页面</div>
              ) : (
                pageList.map((p) => {
                  const current = p.page_number === activePage
                  const marked = isPageMarked(docId, p.page_number)
                  return (
                    <button
                      key={p.page_number}
                      type="button"
                      onClick={() => scrollToPage(p.page_number)}
                      className={cn(
                        "w-full text-left px-2.5 py-2 rounded-md flex items-center gap-1.5 transition-colors mb-0.5",
                        current
                          ? "bg-sea-subtle text-ink font-medium"
                          : "text-ink-soft hover:bg-paper-2"
                      )}
                    >
                      <Pin
                        className={cn(
                          "w-3 h-3 shrink-0",
                          marked ? "text-sea fill-current" : "text-transparent"
                        )}
                        strokeWidth={2}
                      />
                      <span className="text-small truncate flex-1">{p.title}</span>
                      {p.has_builtin_questions && (
                        <Badge variant="neutral" size="sm">
                          题
                        </Badge>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </aside>
        )}

        {mainReader}
        {assistSidebar}
      </div>
    </AppShell>
  )
}
