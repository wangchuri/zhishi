import { useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  NotebookPen,
  Plus,
  SlidersHorizontal,
  ArrowUpDown,
  LayoutGrid,
  List,
} from "lucide-react"
import { AppShell } from "@/components/layout/AppShell"
import { RightPanel } from "@/components/layout/RightPanel"
import { PageHeader } from "@/components/blocks/PageHeader"
import { EmptyState } from "@/components/ui/empty-state"
import { SearchInput } from "@/components/ui/search-input"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import { SegmentedTabs } from "@/components/ui/segmented-tabs"
import { noteFilters } from "@/data/notes"

export function NotesPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState("all")
  const [view, setView] = useState<"grid" | "list">("grid")

  return (
    <AppShell maxWidth={1180}>
      <PageHeader title="笔记" subtitle="记录想法、整理资料，让 Tina 帮你沉淀知识。">
        <Button variant="secondary" size="md">
          <ArrowUpDown className="w-4 h-4" strokeWidth={2} />
          排序
        </Button>
        <Button variant="secondary" size="md">
          <SlidersHorizontal className="w-4 h-4" strokeWidth={2} />
          筛选
        </Button>
        <Button variant="primary" size="md" onClick={() => navigate("/notes")}>
          <Plus className="w-4 h-4" strokeWidth={2} />
          新建笔记
        </Button>
      </PageHeader>

      {/* 统计 */}
      <div className="flex items-center gap-4 mb-6 text-caption text-ink-tertiary">
        <span>全部 <strong className="text-ink-primary font-semibold">0</strong></span>
        <span className="text-line">·</span>
        <span>待整理 <strong className="text-ink-primary font-semibold">0</strong></span>
        <span className="text-line">·</span>
        <span>有 AI 摘要 <strong className="text-ink-primary font-semibold">0</strong></span>
      </div>

      {/* 搜索 + 筛选 + 视图切换 */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
        <div className="flex-1 max-w-md">
          <SearchInput placeholder="搜索笔记..." />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {noteFilters.map((f) => (
            <Chip
              key={f.value}
              variant={filter === f.value ? "selected" : "filter"}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </Chip>
          ))}
        </div>
        <div className="ml-auto">
          <SegmentedTabs
            value={view}
            onChange={(v) => setView(v as "grid" | "list")}
            tabs={[
              { label: "卡片", value: "grid", icon: LayoutGrid },
              { label: "列表", value: "list", icon: List },
            ]}
            size="sm"
          />
        </div>
      </div>

      {/* 内容区 */}
      <div className="bg-surface border border-line-soft rounded-lg shadow-xs">
        <EmptyState
          icon={NotebookPen}
          title="还没有笔记"
          description="记录想法、整理资料，或让 Tina 帮你总结文档。"
          primaryAction={{ label: "新建第一篇笔记" }}
          secondaryAction={{ label: "从文档生成", onClick: () => navigate("/knowledge/upload") }}
          size="lg"
        />
      </div>

      {/* 右侧栏 */}
      <RightPanel title="标签与整理">
        <div className="text-small text-ink-tertiary">暂无数据，上传文档后自动分析</div>
      </RightPanel>
    </AppShell>
  )
}