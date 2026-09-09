import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import {
  CheckCircle2,
  ChevronLeft,
  FileText,
  FolderOpen,
  HelpCircle,
  Loader2,
  Plus,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react"
import { AppShell } from "@/components/layout/AppShell"
import { PageHeader } from "@/components/blocks/PageHeader"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { StatCard } from "@/components/ui/stat-card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { kbApi, questionsApi, quizApi, getThumbnailUrl } from "@/lib/api"
import { mapKbDocument } from "@/lib/mapKbDocument"
import { toast } from "sonner"
import type {
  DocumentGroupDetail,
  KnowledgeDoc,
  Question,
  QuestionListResult,
  QuizSession,
} from "@/types"
import { QuizBookCard } from "./QuizBookCard"
import { QuizStartPanel, type QuizFilterMode } from "./QuizStartPanel"

function matchesFilter(q: Question, mode: QuizFilterMode): boolean {
  if (mode === "undone") return !(q.attempt_count && q.attempt_count > 0)
  if (mode === "wrong") return q.user_answer_status === "wrong"
  if (mode === "unknown") return q.user_answer_status === "unknown"
  return true
}

function matchesTags(q: Question, tags: string[]): boolean {
  if (!tags.length) return true
  const qTags = new Set(q.tags || [])
  return tags.some((t) => qTags.has(t))
}

export function QuizGroupDetailPage() {
  const { groupId } = useParams<{ groupId: string }>()
  const navigate = useNavigate()

  const [group, setGroup] = useState<DocumentGroupDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [questionData, setQuestionData] = useState<QuestionListResult | null>(null)
  const [filterMode, setFilterMode] = useState<QuizFilterMode>("all")
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [starting, setStarting] = useState(false)
  const [dissolveOpen, setDissolveOpen] = useState(false)
  const [dissolving, setDissolving] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [ungrouped, setUngrouped] = useState<KnowledgeDoc[]>([])
  const [adding, setAdding] = useState(false)
  const [pickIds, setPickIds] = useState<string[]>([])

  const load = useCallback(async () => {
    if (!groupId) return
    setLoading(true)
    try {
      const g = await kbApi.getGroup(groupId)
      const docs = (g.documents || []).map((d) =>
        mapKbDocument(d as unknown as Record<string, unknown>, d.zone)
      )
      setGroup({ ...g, documents: docs })
      const qs = await questionsApi.list({ group_id: groupId })
      setQuestionData(qs as QuestionListResult)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载资料组失败")
      setGroup(null)
    } finally {
      setLoading(false)
    }
  }, [groupId])

  useEffect(() => {
    void load()
  }, [load])

  const matchCount = useMemo(() => {
    const qs = questionData?.questions || []
    return qs.filter((q) => matchesFilter(q, filterMode) && matchesTags(q, selectedTags)).length
  }, [questionData, filterMode, selectedTags])

  const availableTags = useMemo(() => {
    if (group?.tags?.length) return group.tags
    const seen = new Set<string>()
    const out: string[] = []
    for (const q of questionData?.questions || []) {
      for (const t of q.tags || []) {
        if (!seen.has(t)) {
          seen.add(t)
          out.push(t)
        }
      }
    }
    return out
  }, [group?.tags, questionData])

  const handleStart = async () => {
    if (!groupId) return
    setStarting(true)
    try {
      const res = await quizApi.createSession({
        group_id: groupId,
        filter: filterMode,
        tags: selectedTags.length ? selectedTags : undefined,
        title: group?.name ? `${group.name} · 混合刷题` : undefined,
      })
      navigate(`/quiz/session?session_id=${(res as QuizSession).id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "开始刷题失败")
    } finally {
      setStarting(false)
    }
  }

  const handleDissolve = async () => {
    if (!groupId) return
    setDissolving(true)
    try {
      await kbApi.deleteGroup(groupId)
      toast.success("已解散资料组，文档仍保留")
      navigate("/quiz")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "解散失败")
    } finally {
      setDissolving(false)
    }
  }

  const openAdd = async () => {
    if (!group?.collection_id) {
      toast.error("资料组未绑定分区，无法添加")
      return
    }
    setAddOpen(true)
    setPickIds([])
    try {
      const res = await kbApi.listDocuments(1, 100, group.collection_id, { ungroupedOnly: true })
      setUngrouped(
        ((res.documents || []) as Record<string, unknown>[]).map((d) => mapKbDocument(d))
      )
    } catch {
      setUngrouped([])
    }
  }

  const confirmAdd = async () => {
    if (!groupId || !pickIds.length) return
    setAdding(true)
    try {
      await kbApi.addGroupDocuments(groupId, pickIds)
      setAddOpen(false)
      toast.success(`已加入 ${pickIds.length} 份资料`)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "添加失败")
    } finally {
      setAdding(false)
    }
  }

  const removeDoc = async (docId: string) => {
    if (!groupId) return
    try {
      await kbApi.removeGroupDocument(groupId, docId)
      toast.success("已移出资料组")
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "移出失败")
    }
  }

  const stats = group?.stats
  const docs = group?.documents || []

  return (
    <AppShell maxWidth={1180}>
      <PageHeader
        title={group?.name || "资料组"}
        subtitle={group?.description || "系列资料混合刷题"}
      >
        <Button variant="ghost" size="sm" onClick={() => navigate("/quiz")}>
          <ChevronLeft className="w-4 h-4" />
          返回
        </Button>
      </PageHeader>

      {loading ? (
        <div className="flex items-center justify-center py-20 gap-2 text-ink-tertiary">
          <Loader2 className="w-5 h-5 animate-spin" />
          加载中...
        </div>
      ) : !group ? (
        <p className="text-body text-ink-tertiary">资料组不存在</p>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="primary" size="sm">
              <FolderOpen className="w-3 h-3 mr-0.5" />
              资料组 · {docs.length} 份
            </Badge>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                navigate(`/knowledge/upload?group_id=${groupId}&collection_id=${group.collection_id || ""}`)
              }
            >
              <Upload className="w-4 h-4" />
              上传到本组
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void openAdd()}>
              <Plus className="w-4 h-4" />
              移入已有资料
            </Button>
            <Button variant="ghost" size="sm" className="text-danger" onClick={() => setDissolveOpen(true)}>
              <Trash2 className="w-4 h-4" />
              解散组
            </Button>
          </div>

          {stats && stats.total > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard icon={FileText} label="总题数" value={stats.total} tone="primary" />
              <StatCard icon={CheckCircle2} label="正确" value={stats.correct} tone="success" />
              <StatCard icon={XCircle} label="错误" value={stats.wrong} tone="warning" />
              <StatCard icon={HelpCircle} label="不会" value={stats.unknown} tone="warning" />
            </div>
          ) : null}

          {(stats?.total ?? 0) > 0 ? (
            <QuizStartPanel
              availableTags={availableTags}
              matchCount={matchCount}
              filterMode={filterMode}
              onFilterModeChange={setFilterMode}
              selectedTags={selectedTags}
              onSelectedTagsChange={setSelectedTags}
              onStart={() => void handleStart()}
              starting={starting}
              title="混合刷题"
            />
          ) : (
            <div className="bg-surface border border-line-soft rounded-lg p-5 text-center text-ink-tertiary">
              组内暂无可刷题目，先给成员资料出题
            </div>
          )}

          <div>
            <h2 className="text-card-title font-semibold text-ink-primary mb-3">组内资料</h2>
            {docs.length === 0 ? (
              <p className="text-small text-ink-tertiary">还没有资料，上传或移入几份吧</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {docs.map((doc) => (
                  <div key={doc.id} className="relative">
                    <QuizBookCard
                      doc={doc}
                      stats={
                        null
                      }
                      onClick={() => navigate(`/quiz/doc/${doc.id}`)}
                    />
                    <button
                      type="button"
                      title="移出资料组"
                      className="absolute top-2 right-2 z-10 rounded-full bg-paper/90 border border-line p-1 text-ink-tertiary hover:text-danger"
                      onClick={(e) => {
                        e.stopPropagation()
                        void removeDoc(doc.id)
                      }}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <AlertDialog open={dissolveOpen} onOpenChange={setDissolveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>解散资料组？</AlertDialogTitle>
            <AlertDialogDescription>
              仅解散分组，组内文档不会删除，会回到资料列表平铺显示。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dissolving}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDissolve()} disabled={dissolving}>
              {dissolving ? "处理中..." : "解散"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={addOpen} onOpenChange={setAddOpen}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>移入已有资料</AlertDialogTitle>
            <AlertDialogDescription>选择未入组的资料加入本组</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-64 overflow-y-auto space-y-2 py-2">
            {ungrouped.length === 0 ? (
              <p className="text-small text-ink-tertiary">没有可移入的未入组资料</p>
            ) : (
              ungrouped.map((d) => {
                const on = pickIds.includes(d.id)
                return (
                  <label
                    key={d.id}
                    className={`flex items-center gap-3 p-2 rounded-lg border cursor-pointer ${
                      on ? "border-primary bg-primary/5" : "border-line-soft"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setPickIds((prev) =>
                          on ? prev.filter((x) => x !== d.id) : [...prev, d.id]
                        )
                      }
                    />
                    {d.id && (
                      <img
                        src={getThumbnailUrl(d.id)}
                        alt=""
                        className="w-8 h-10 object-cover rounded"
                        onError={(e) => {
                          ;(e.target as HTMLImageElement).style.display = "none"
                        }}
                      />
                    )}
                    <span className="text-small line-clamp-1">{d.name}</span>
                  </label>
                )
              })
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={adding}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmAdd()} disabled={adding || !pickIds.length}>
              {adding ? "添加中..." : `加入（${pickIds.length}）`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  )
}
