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
import { MarkdownWithMath } from "@/components/blocks/MarkdownWithMath"
import { getApiBase } from "@/lib/api"
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
import type { DocumentPage, DocumentPageDetail } from "@/types"
import { CompanionChatSidebar } from "./CompanionChatSidebar"
import { TipPanel } from "./TipPanel"
import { toast } from "sonner"

/** 电子书式阅读正文排版（比默认 prose 更大、更松） */
const readingProseClass =
  "prose prose-lg max-w-none prose-headings:text-ink prose-p:text-ink prose-p:my-2 prose-strong:text-ink prose-a:text-sea prose-code:bg-paper-2 prose-code:px-1 prose-code:rounded prose-code:text-small prose-pre:bg-paper-2 prose-pre:border prose-pre:border-line prose-ul:my-2 prose-ol:my-2"

interface PageListMeta {
  document_name: string
  total_pages: number
  preview_mode?: string
  has_page_markers?: boolean
}

export function CompanionReadPage() {
  const { docId = "" } = useParams<{ docId: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const pageFromUrl = Number(searchParams.get("page"))

  const imageBase = docId
    ? `${getApiBase().replace(/\/$/, "")}/api/v1/kb/documents/${encodeURIComponent(docId)}/images`
    : undefined

  const [pageList, setPageList] = useState<DocumentPage[]>([])
  const [meta, setMeta] = useState<PageListMeta | null>(null)
  const [loadingPages, setLoadingPages] = useState(true)
  const [fullContent, setFullContent] = useState("")
  const [activePage, setActivePage] = useState<number | null>(null)
  const [pageDetail, setPageDetail] = useState<DocumentPageDetail | null>(null)
  const [railOpen, setRailOpen] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [tipOpen, setTipOpen] = useState(false)
  const [, setRevision] = useState(0)
  const markedPages = getMarkedPages(docId)

  const scrollRef = useRef<HTMLDivElement>(null)
  const activePageRef = useRef<number | null>(null)
  const resumedRef = useRef(false)

  // 加载页列表 + 全文（md/txt 用于连续切片展示）
  useEffect(() => {
    if (!docId) return
    let cancelled = false
    setLoadingPages(true)
    Promise.all([
      kbApi.getDocumentPages(docId),
      kbApi.getDocumentContent(docId).catch(() => null),
    ])
      .then(([res, contentMeta]) => {
        if (cancelled) return
        const pages = res.pages || []
        setPageList(pages)
        setMeta({
          document_name: res.document_name,
          total_pages: res.total_pages,
          preview_mode: res.preview_mode,
          has_page_markers: res.has_page_markers,
        })
        setFullContent(contentMeta?.content ?? "")
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
      .catch(() => setPageList([]))
      .finally(() => {
        if (!cancelled) setLoadingPages(false)
      })
    return () => {
      cancelled = true
    }
  }, [docId])

  // 加载当前页详情（AI 上下文）
  useEffect(() => {
    if (!docId || !activePage) return
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
  }, [docId, activePage])

  // 记录阅读进度
  useEffect(() => {
    if (docId && activePage != null) setProgress(docId, activePage)
  }, [docId, activePage])

  useEffect(() => {
    activePageRef.current = activePage
  }, [activePage])

  // 浏览器全屏状态同步（Esc 退出时跟随）
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", onFs)
    return () => document.removeEventListener("fullscreenchange", onFs)
  }, [])

  const docName = meta?.document_name || "文档"
  const totalPages = meta?.total_pages ?? pageList.length
  const currentMarked = activePage != null && markedPages.includes(activePage)

  // 滚动自动翻页：以视口 35% 高度线定位当前页
  const handleScroll = useCallback(() => {
    const container = scrollRef.current
    if (!container) return
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
  }, [])

  const scrollToPage = useCallback(
    (n: number, smooth = true) => {
      const container = scrollRef.current
      if (!container) return
      const section = container.querySelector<HTMLElement>(`[data-page="${n}"]`)
      if (section) {
        container.scrollTo({ top: section.offsetTop - 8, behavior: smooth ? "smooth" : "auto" })
      }
    },
    []
  )

  // 恢复上次阅读位置（等页面渲染出来后再滚动）
  useEffect(() => {
    if (resumedRef.current) return
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
  }, [docId, pageList, pageFromUrl])

  const toggleMark = useCallback(() => {
    if (!docId || activePage == null) return
    const next = toggleMarkedPage(docId, activePage)
    setRevision((r) => r + 1)
    toast.success(next.includes(activePage) ? "已标记为重点页" : "已取消重点标记")
  }, [docId, activePage])

  const handleSaveTip = useCallback(
    async (content: string, title?: string) => {
      if (!docId || activePage == null) return
      try {
        await notesApi.saveTip({
          document_id: docId,
          page_number: activePage,
          title: title?.trim() || `第 ${activePage} 页摘录`,
          content,
        })
        toast.success(`已 tip 到《${docName}》第 ${activePage} 页的笔记`)
      } catch {
        toast.error("保存笔记失败，请检查服务器连接")
      }
    },
    [docId, activePage, docName]
  )

  const enterFullscreen = () => {
    document.documentElement.requestFullscreen?.().catch(() => {})
    setFullscreen(true)
  }
  const exitFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    setFullscreen(false)
  }

  // 连续滚动阅读内容（md/txt 切片）
  const renderReadingContent = () => {
    if (loadingPages) {
      return (
        <div className="flex items-center justify-center py-24 text-ink-disabled gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>加载文档…</span>
        </div>
      )
    }
    if (pageList.length === 0) {
      return <div className="flex items-center justify-center py-24 text-ink-disabled">暂无页面</div>
    }
    return (
      <div className="max-w-[820px] mx-auto">
        {pageList.map((p, i) => {
          const text = (fullContent || "").slice(p.char_start, p.char_end).trim()
          return (
            <section key={p.page_number} data-page={p.page_number}>
              <MarkdownWithMath proseClass={readingProseClass} imageBaseUrl={imageBase}>
                {text || "（本页无文本）"}
              </MarkdownWithMath>
              {i < pageList.length - 1 && <hr className="my-10 border-line-light" />}
            </section>
          )
        })}
      </div>
    )
  }

  const markButton = (className: string) => (
    <button
      type="button"
      onClick={toggleMark}
      disabled={activePage == null}
      className={cn(
        "inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-small font-medium transition-colors shrink-0",
        currentMarked ? "bg-sea-subtle text-sea" : "text-ink-soft hover:bg-paper-2 hover:text-sea",
        className
      )}
    >
      <Bookmark className={cn("w-4 h-4", currentMarked && "fill-current")} strokeWidth={2} />
      标为重点
    </button>
  )

  return (
    <>
      {fullscreen ? (
        /* ────── 全屏阅读：连续滚动正文 + 推入式伴学侧边栏 + 迷你指示条 ────── */
        <div
          className="h-dvh bg-paper flex relative"
          data-tip-doc={docId}
          data-tip-doc-name={docName}
        >
          <div className="flex flex-col flex-1 min-w-0 relative">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="relative flex-1 min-h-0 overflow-y-auto scroll-thin p-6 md:p-10 bg-paper"
          >
            {renderReadingContent()}
            <div className="h-24" />
          </div>

          {/* 迷你指示条（滚动即翻页，无需点击） */}
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-0.5 rounded-full border border-line-light bg-paper/90 backdrop-blur px-2 py-1 shadow-md">
            <span className="text-caption text-ink-soft px-1 whitespace-nowrap">
              第 {activePage ?? "—"} / {totalPages || "—"} 页
            </span>
            <div className="w-px h-5 bg-line mx-1" />
            <button
              type="button"
              onClick={toggleMark}
              disabled={activePage == null}
              className={cn(
                "inline-flex items-center gap-1 h-8 px-2.5 rounded-full text-caption font-medium transition-colors",
                currentMarked ? "bg-sea-subtle text-sea" : "text-ink-soft hover:text-sea"
              )}
            >
              <Bookmark className={cn("w-3.5 h-3.5", currentMarked && "fill-current")} strokeWidth={2} />
              重点
            </button>
            <button
              type="button"
              onClick={() => setChatOpen((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1 h-8 px-2.5 rounded-full text-caption font-medium transition-colors",
                chatOpen ? "bg-sea-subtle text-sea" : "text-ink-soft hover:text-sea"
              )}
              aria-label="打开 AI 伴学对话"
            >
              <Bot className="w-3.5 h-3.5" strokeWidth={2} />
              AI
            </button>
            <button
              type="button"
              onClick={() => setTipOpen((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1 h-8 px-2.5 rounded-full text-caption font-medium transition-colors",
                tipOpen ? "bg-sea-subtle text-sea" : "text-ink-soft hover:text-sea"
              )}
              aria-label="打开本书笔记"
            >
              <FileText className="w-3.5 h-3.5" strokeWidth={2} />
              笔记
            </button>
            <button
              type="button"
              onClick={exitFullscreen}
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-full text-caption text-ink-soft hover:text-ink transition-colors"
              aria-label="退出全屏"
            >
              <Minimize2 className="w-3.5 h-3.5" strokeWidth={2} />
              退出
            </button>
          </div>
          </div>{/* 全屏正文 wrapper 结束 */}

          {/* 伴学侧边栏（推入式，普通/全屏共用） */}
          <CompanionChatSidebar
            docId={docId}
            docName={docName}
            pageNumber={activePage}
            pageContent={pageDetail?.content || ""}
            open={chatOpen}
            onOpenChange={setChatOpen}
            onSaveTip={handleSaveTip}
          />
        </div>
      ) : (
        /* ────── 普通阅读：目录 | 连续滚动主区 ────── */
        <AppShell maxWidth={null} noPadding>
          <div className="flex h-full min-h-0">
            {/* 左：目录（点击跳转，滚动为主） */}
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
                          className={cn("w-3 h-3 shrink-0", marked ? "text-sea fill-current" : "text-transparent")}
                          strokeWidth={2}
                        />
                        <span className="text-small truncate flex-1">{p.title}</span>
                        {p.has_builtin_questions && <Badge variant="neutral" size="sm">题</Badge>}
                      </button>
                    )
                  })
                )}
              </div>
            </aside>

            {/* 主阅读区（连续滚动） */}
            <div
              className="flex-1 flex flex-col min-w-0"
              data-tip-doc={docId}
              data-tip-doc-name={docName}
            >
              <div className="h-14 shrink-0 border-b border-line-light bg-paper flex items-center gap-2 px-4">
                {!railOpen && (
                  <button
                    type="button"
                    onClick={() => setRailOpen(true)}
                    className="w-9 h-9 rounded-md flex items-center justify-center text-ink-disabled hover:text-ink hover:bg-paper-2 transition-colors shrink-0"
                    aria-label="展开目录"
                  >
                    <PanelLeftOpen className="w-4 h-4" strokeWidth={2} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => navigate(docId ? `/quiz/doc/${docId}` : "/quiz")}
                  className="w-9 h-9 rounded-md flex items-center justify-center text-ink-disabled hover:text-ink hover:bg-paper-2 transition-colors shrink-0"
                  aria-label="返回资料"
                >
                  <ArrowLeft className="w-4 h-4" strokeWidth={2} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="text-small font-semibold text-ink truncate leading-tight">{docName}</div>
                  <div className="text-caption text-ink-disabled leading-tight">
                    第 {activePage ?? "—"} 页{totalPages ? ` / 共 ${totalPages} 页` : ""} · 滚动阅读
                  </div>
                </div>

                {markButton("")}

                <button
                  type="button"
                  onClick={() => setChatOpen((v) => !v)}
                  className={cn(
                    "w-9 h-9 rounded-md flex items-center justify-center transition-colors shrink-0",
                    chatOpen ? "text-sea bg-sea-subtle" : "text-ink-disabled hover:bg-paper-2 hover:text-ink"
                  )}
                  aria-label="打开 AI 伴学对话"
                  title="AI 伴学对话"
                >
                  <Bot className="w-4 h-4" strokeWidth={2} />
                </button>

                <button
                  type="button"
                  onClick={() => setTipOpen((v) => !v)}
                  className={cn(
                    "w-9 h-9 rounded-md flex items-center justify-center transition-colors shrink-0",
                    tipOpen ? "text-sea bg-sea-subtle" : "text-ink-disabled hover:bg-paper-2 hover:text-ink"
                  )}
                  aria-label="打开本书笔记"
                  title="本书笔记"
                >
                  <FileText className="w-4 h-4" strokeWidth={2} />
                </button>

                <button
                  type="button"
                  onClick={enterFullscreen}
                  className="w-9 h-9 rounded-md flex items-center justify-center text-ink-disabled hover:text-ink hover:bg-paper-2 transition-colors shrink-0"
                  aria-label="全屏阅读"
                  title="全屏阅读"
                >
                  <Maximize className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>

              <div
                ref={scrollRef}
                onScroll={handleScroll}
                className="relative flex-1 overflow-y-auto scroll-thin p-6 md:p-8 bg-paper"
              >
                {renderReadingContent()}
                <div className="h-24" />
              </div>
            </div>

            {/* 伴学侧边栏（推入式，挤压主内容区） */}
            <CompanionChatSidebar
              docId={docId}
              docName={docName}
              pageNumber={activePage}
              pageContent={pageDetail?.content || ""}
              open={chatOpen}
              onOpenChange={setChatOpen}
              onSaveTip={handleSaveTip}
            />
          </div>
        </AppShell>
      )}

      {/* 划选（普通/全屏共用） */}
      <TipPanel
        docId={docId}
        open={tipOpen}
        onOpenChange={setTipOpen}
        onJumpToPage={scrollToPage}
      />
    </>
  )
}
