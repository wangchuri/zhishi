import { useEffect, useMemo, useState } from "react"
import { Loader2, Play, RefreshCw, Tags } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { QuizSession } from "@/types"

export type QuizFilterMode = "all" | "undone" | "wrong" | "unknown"

export const QUIZ_FILTER_OPTIONS: {
  value: QuizFilterMode
  label: string
  desc: string
}[] = [
  { value: "all", label: "从头开始", desc: "按顺序刷全部题目" },
  { value: "undone", label: "未做", desc: "只刷还没做过的题" },
  { value: "wrong", label: "错题", desc: "上次做错的题" },
  { value: "unknown", label: "不会", desc: "标记为不会的题" },
]

type QuizStartPanelProps = {
  availableTags: string[]
  /** 给定筛选条件后的可刷题数（由父组件计算） */
  matchCount: number
  filterMode: QuizFilterMode
  onFilterModeChange: (mode: QuizFilterMode) => void
  selectedTags: string[]
  onSelectedTagsChange: (tags: string[]) => void
  activeSession?: QuizSession | null
  onResume?: () => void
  onStart: () => void
  starting?: boolean
  disabled?: boolean
  title?: string
}

export function QuizStartPanel({
  availableTags,
  matchCount,
  filterMode,
  onFilterModeChange,
  selectedTags,
  onSelectedTagsChange,
  activeSession,
  onResume,
  onStart,
  starting,
  disabled,
  title = "开始刷题",
}: QuizStartPanelProps) {
  const [tagDialogOpen, setTagDialogOpen] = useState(false)
  const [draftTags, setDraftTags] = useState<string[]>([])
  const [tagQuery, setTagQuery] = useState("")

  const allSelected = selectedTags.length === 0

  const tagHint = useMemo(() => {
    if (allSelected) return "全部知识点"
    if (selectedTags.length <= 2) return selectedTags.join("、")
    return `已选 ${selectedTags.length} 个`
  }, [allSelected, selectedTags])

  useEffect(() => {
    if (!tagDialogOpen) return
    setDraftTags(selectedTags)
    setTagQuery("")
  }, [tagDialogOpen, selectedTags])

  const filteredTags = useMemo(() => {
    const q = tagQuery.trim().toLowerCase()
    if (!q) return availableTags
    return availableTags.filter((t) => t.toLowerCase().includes(q))
  }, [availableTags, tagQuery])

  const draftAll = draftTags.length === 0

  const toggleDraftTag = (tag: string) => {
    setDraftTags((prev) => {
      if (prev.includes(tag)) return prev.filter((t) => t !== tag)
      return [...prev, tag]
    })
  }

  const confirmTags = () => {
    onSelectedTagsChange(draftTags)
    setTagDialogOpen(false)
  }

  return (
    <div className="bg-surface border border-line-soft rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-card-title font-semibold text-ink-primary">{title}</div>
        <span className="text-caption text-ink-tertiary">约 {matchCount} 题</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {QUIZ_FILTER_OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={`flex items-center gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
              filterMode === opt.value
                ? "border-primary bg-primary/5 text-ink-primary"
                : "border-line-soft hover:border-line text-ink-secondary"
            }`}
          >
            <input
              type="radio"
              name="quiz-filter"
              value={opt.value}
              checked={filterMode === opt.value}
              onChange={() => onFilterModeChange(opt.value)}
              className="accent-primary shrink-0"
            />
            <div className="min-w-0">
              <div className="text-small font-medium">{opt.label}</div>
              <div className="text-caption text-ink-tertiary truncate">{opt.desc}</div>
            </div>
          </label>
        ))}
      </div>

      {availableTags.length > 0 && (
        <button
          type="button"
          onClick={() => setTagDialogOpen(true)}
          className="w-full flex items-center justify-between gap-3 p-3 rounded-lg border border-line-soft hover:border-line text-left transition-colors"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Tags className="w-4 h-4 text-sea shrink-0" strokeWidth={2} />
            <span className="text-small text-ink-primary truncate">
              知识点 · {tagHint}
            </span>
          </span>
          <span className="text-caption text-sea shrink-0">选择</span>
        </button>
      )}

      {activeSession && onResume && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-warning/5 border border-warning/20">
          <div className="flex items-center gap-2 text-small text-ink-primary">
            <RefreshCw className="w-4 h-4 text-warning" />
            <span>
              有未完成的练习（{activeSession.answered_count}/{activeSession.total_questions} 题已答）
            </span>
          </div>
          <Button variant="secondary" size="sm" onClick={onResume}>
            继续
          </Button>
        </div>
      )}

      <Button
        variant="primary"
        size="lg"
        onClick={onStart}
        disabled={disabled || starting || matchCount === 0}
        className="w-full"
        style={{ color: "#FFFFFF" }}
      >
        {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" strokeWidth={2} />}
        {filterMode === "all" ? "开始刷题" : `开始${QUIZ_FILTER_OPTIONS.find((o) => o.value === filterMode)?.label}`}
        {matchCount > 0 ? `（${matchCount}）` : ""}
      </Button>

      <Dialog open={tagDialogOpen} onOpenChange={setTagDialogOpen}>
        <DialogContent className="sm:max-w-md max-h-[85dvh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="px-5 pt-5 pb-3 shrink-0">
            <DialogTitle>选择知识点</DialogTitle>
            <DialogDescription>
              默认全部；点选具体知识点后按并集筛选。共 {availableTags.length} 个。
            </DialogDescription>
          </DialogHeader>

          <div className="px-5 pb-3 shrink-0 space-y-2">
            <input
              value={tagQuery}
              onChange={(e) => setTagQuery(e.target.value)}
              placeholder="搜索知识点"
              className="w-full h-9 px-3 rounded-lg border border-line-soft bg-surface-soft text-small text-ink-primary placeholder:text-ink-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setDraftTags([])}
                className={`rounded-full px-2.5 py-1 text-caption font-medium border transition-colors ${
                  draftAll
                    ? "bg-sea text-paper border-sea"
                    : "bg-paper text-ink-soft border-line hover:border-sea/35"
                }`}
              >
                全部
              </button>
              <span className="text-caption text-ink-tertiary">
                {draftAll ? "已选全部" : `已选 ${draftTags.length} 个`}
              </span>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto scroll-thin px-5 pb-2">
            <div className="flex flex-col gap-1.5 pb-2">
              {filteredTags.length === 0 ? (
                <p className="text-small text-ink-tertiary py-6 text-center">没有匹配的知识点</p>
              ) : (
                filteredTags.map((tag) => {
                  const on = draftTags.includes(tag)
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleDraftTag(tag)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg border text-small transition-colors ${
                        on
                          ? "border-primary bg-primary/5 text-ink-primary font-medium"
                          : "border-line-soft text-ink-secondary hover:border-line"
                      }`}
                    >
                      {tag}
                    </button>
                  )
                })
              )}
            </div>
          </div>

          <DialogFooter className="px-5 py-4 border-t border-line-soft shrink-0">
            <Button variant="secondary" onClick={() => setTagDialogOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={confirmTags} style={{ color: "#FFFFFF" }}>
              确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
