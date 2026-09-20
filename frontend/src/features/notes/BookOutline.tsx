import { useEffect, useState } from "react"
import { GitBranch, List, Loader2 } from "lucide-react"
import { ChapterMindMap } from "@/components/blocks/ChapterMindMap"
import { kbApi } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { LearningPathResult } from "@/types"

/** 书本目录 ⇄ 书本思维大纲 */
export function BookOutline({ documentId }: { documentId: string }) {
  const [data, setData] = useState<LearningPathResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<"list" | "map">("list")
  const [activeChapter, setActiveChapter] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    kbApi
      .getLearningPath(documentId)
      .then((r) => {
        if (!cancelled) setData(r)
      })
      .catch(() => {
        if (!cancelled) setData(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [documentId])

  const chapters = data?.chapters || []

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-ink-disabled gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> 读取目录…
      </div>
    )
  }

  if (chapters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-ink-disabled gap-2 px-4 text-center">
        <List className="w-5 h-5" strokeWidth={1.8} />
        <span className="text-caption">这本书还没有目录。可在资料页生成学习路径。</span>
      </div>
    )
  }

  const goChapter = (index: number) => {
    setActiveChapter(index)
    setView("map")
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <button
        type="button"
        onClick={() => setView((v) => (v === "list" ? "map" : "list"))}
        aria-expanded={view === "map"}
        className="flex items-center gap-2 px-3 py-2 border-b border-line-light text-left shrink-0 hover:bg-sea-subtle/40 transition-colors"
        title="点击切换目录 / 思维大纲"
      >
        {view === "list" ? (
          <GitBranch className="w-4 h-4 text-sea" strokeWidth={2} />
        ) : (
          <List className="w-4 h-4 text-sea" strokeWidth={2} />
        )}
        <span className="font-display text-title-s text-ink">
          {view === "list" ? "书本目录" : "书本思维大纲"}
        </span>
        <span className="ml-auto text-[11px] text-sea">
          {view === "list" ? "展开思维导图 →" : "← 返回目录"}
        </span>
      </button>

      {view === "list" ? (
        <ol className="flex-1 overflow-y-auto scroll-thin p-3 space-y-2 list-none">
          {chapters.map((ch, i) => (
            <li key={ch.id || i}>
              <button
                type="button"
                onClick={() => goChapter(i)}
                title="点击查看思维导图"
                className="w-full text-left rounded-lg border border-line-light bg-paper-2/40 px-2.5 py-2 hover:border-sea/40 hover:bg-sea-subtle/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-ink-disabled tabular-nums">{i + 1}</span>
                  <span className={cn("text-caption text-ink", ch.learned && "text-sea")}>
                    {ch.title}
                  </span>
                  {ch.learned ? <span className="text-[10px] text-sea ml-auto">学过</span> : null}
                </div>
                {(ch.key_points || []).length > 0 ? (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(ch.key_points || []).map((kp) => (
                      <span
                        key={kp}
                        className="h-5 px-1.5 rounded-full bg-sea-subtle text-sea text-[10px] leading-5"
                      >
                        {kp}
                      </span>
                    ))}
                  </div>
                ) : null}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <ChapterMindMap
          chapters={chapters}
          title={data?.title}
          activeChapter={activeChapter}
          onPickChapter={setActiveChapter}
        />
      )}
    </div>
  )
}
