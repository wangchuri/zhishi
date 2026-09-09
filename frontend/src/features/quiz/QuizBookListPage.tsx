import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Brain, FolderPlus, Loader2, Library, Play, Upload } from "lucide-react"
import { AppShell } from "@/components/layout/AppShell"
import { PageHeader } from "@/components/blocks/PageHeader"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useKbDocuments } from "@/hooks/useKbDocuments"
import { kbApi, questionsApi, quizApi } from "@/lib/api"
import { toast } from "sonner"
import { QuizBookCard, type BookCardStats } from "./QuizBookCard"
import { QuizGroupCard } from "./QuizGroupCard"
import { QuestionGenJobsBanner } from "./QuestionGenJobsBanner"
import type { DocumentGroupItem, KnowledgeDoc, QuestionGenJob } from "@/types"

export function QuizBookListPage() {
  const navigate = useNavigate()
  const {
    collections,
    selectedCollectionId,
    setSelectedCollectionId,
    selectedCollection,
    documents,
    loadingCollections,
    refreshDocuments,
  } = useKbDocuments({ preferZone: "study", ungroupedOnly: true })

  const [statsMap, setStatsMap] = useState<Record<string, BookCardStats>>({})
  const [loadingStats, setLoadingStats] = useState(false)
  const [genJobs, setGenJobs] = useState<QuestionGenJob[]>([])
  const [statsEpoch, setStatsEpoch] = useState(0)
  const [ongoingCount, setOngoingCount] = useState(0)
  const hadJobsRef = useRef(false)
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeDoc | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [groups, setGroups] = useState<DocumentGroupItem[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [newGroupName, setNewGroupName] = useState("")
  const [creating, setCreating] = useState(false)

  const loadGroups = async () => {
    if (!selectedCollectionId) {
      setGroups([])
      return
    }
    try {
      const res = await kbApi.listGroups(selectedCollectionId)
      setGroups(res.groups || [])
    } catch {
      setGroups([])
    }
  }

  useEffect(() => {
    void loadGroups()
  }, [selectedCollectionId, statsEpoch])

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await kbApi.deleteDocument(deleteTarget.id)
      setDeleteTarget(null)
      setStatsMap((prev) => {
        const next = { ...prev }
        delete next[deleteTarget.id]
        return next
      })
      await refreshDocuments()
      setStatsEpoch((n) => n + 1)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "删除失败，请稍后重试")
    } finally {
      setDeleting(false)
    }
  }

  const handleCreateGroup = async () => {
    const name = newGroupName.trim()
    if (!name || !selectedCollectionId) return
    setCreating(true)
    try {
      const g = await kbApi.createGroup({ name, collection_id: selectedCollectionId })
      setCreateOpen(false)
      setNewGroupName("")
      toast.success("已创建资料组")
      navigate(`/quiz/group/${g.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建失败")
    } finally {
      setCreating(false)
    }
  }

  const studyDocs = useMemo(() => {
    return documents.filter((d) => d.zone !== "life" || !selectedCollection?.zone)
  }, [documents, selectedCollection])

  useEffect(() => {
    if (studyDocs.length === 0) {
      setStatsMap({})
      return
    }
    let cancelled = false
    setLoadingStats(true)

    const loadAll = async () => {
      const results: Record<string, BookCardStats> = {}
      for (const doc of studyDocs) {
        if (cancelled) return
        try {
          const res = await questionsApi.list({ document_id: doc.id })
          const items = res.questions || []
          const total = res.total ?? (Array.isArray(items) ? items.length : 0)
          results[doc.id] = {
            total,
            answered: res.answered_count ?? 0,
            correct: res.correct_count ?? 0,
            wrong: res.wrong_count ?? 0,
            unknown: res.unknown_count ?? 0,
          }
        } catch {
          results[doc.id] = { total: 0, answered: 0, correct: 0, wrong: 0, unknown: 0 }
        }
      }
      if (!cancelled) setStatsMap(results)
    }

    loadAll().finally(() => {
      if (!cancelled) setLoadingStats(false)
    })

    return () => {
      cancelled = true
    }
  }, [studyDocs, statsEpoch])

  useEffect(() => {
    let cancelled = false
    quizApi
      .listActiveSessions()
      .then((res) => {
        if (!cancelled) setOngoingCount((res.sessions || []).length)
      })
      .catch(() => {
        if (!cancelled) setOngoingCount(0)
      })
    return () => {
      cancelled = true
    }
  }, [statsEpoch])

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const res = await questionsApi.listJobs()
        const jobs = res.jobs || []
        if (cancelled) return
        setGenJobs(jobs)
        if (hadJobsRef.current && jobs.length === 0) {
          setStatsEpoch((n) => n + 1)
        }
        hadJobsRef.current = jobs.length > 0
      } catch {
        if (!cancelled) setGenJobs([])
      }
    }
    void tick()
    const timer = window.setInterval(tick, 2500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const processingIds = useMemo(
    () => new Set(genJobs.map((j) => j.document_id)),
    [genJobs]
  )

  const isEmpty = studyDocs.length === 0 && groups.length === 0

  return (
    <AppShell maxWidth={1180}>
      <PageHeader title="资料" subtitle="你的书本、题目都在这里">
        <Button variant="secondary" size="md" onClick={() => setCreateOpen(true)} disabled={!selectedCollectionId}>
          <FolderPlus className="w-4 h-4 mr-2" strokeWidth={2} />
          新建资料组
        </Button>
        <Button variant="primary" size="md" onClick={() => navigate("/knowledge/upload")}>
          <Upload className="w-4 h-4 mr-2" strokeWidth={2} />
          上传
        </Button>
      </PageHeader>

      {loadingCollections ? (
        <div className="flex items-center justify-center py-20 text-ink-tertiary gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>加载中...</span>
        </div>
      ) : collections.length === 0 ? (
        <EmptyState
          icon={Brain}
          title="暂无资料"
          description="先上传学习资料，解析完成后会显示在这里"
          primaryAction={{ label: "去上传", onClick: () => navigate("/knowledge/upload") }}
        />
      ) : isEmpty ? (
        <EmptyState
          icon={Library}
          title="暂无文档"
          description="还没有上传文档，上传后即可刷题、出题；也可先建资料组收纳系列资料"
          primaryAction={{ label: "去上传", onClick: () => navigate("/knowledge/upload") }}
        />
      ) : (
        <div className="space-y-6">
          {ongoingCount > 0 ? (
            <button
              type="button"
              onClick={() => navigate("/quiz/ongoing")}
              className="w-full flex items-center gap-3 rounded-2xl border border-sea/30 bg-sea-subtle/60 px-4 py-3.5 text-left hover:border-sea/50 transition-colors"
            >
              <Play className="w-5 h-5 text-sea shrink-0" strokeWidth={2} />
              <div className="min-w-0 flex-1">
                <p className="text-body font-medium text-ink">有 {ongoingCount} 场刷题还没结束</p>
                <p className="text-caption text-ink-soft">点这里继续上次的进度，不用从头刷</p>
              </div>
              <span className="text-caption text-sea shrink-0">去继续</span>
            </button>
          ) : null}
          <QuestionGenJobsBanner jobs={genJobs} />
          {collections.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {collections.map((coll) => (
                <button
                  key={coll.id}
                  type="button"
                  onClick={() => setSelectedCollectionId(coll.id === selectedCollectionId ? "" : coll.id)}
                  className={`px-3 py-1.5 rounded-lg text-small font-medium transition-colors
                    ${
                      coll.id === selectedCollectionId
                        ? "bg-primary text-white"
                        : "bg-surface-soft text-ink-secondary hover:bg-surface-soft/80 border border-line-soft"
                    }`}
                >
                  {coll.name}
                </button>
              ))}
            </div>
          )}

          {loadingStats && (
            <div className="flex items-center gap-2 text-small text-ink-tertiary">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>加载统计...</span>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {groups.map((g) => (
              <QuizGroupCard key={g.id} group={g} onClick={() => navigate(`/quiz/group/${g.id}`)} />
            ))}
            {studyDocs.map((doc) => (
              <QuizBookCard
                key={doc.id}
                doc={
                  processingIds.has(doc.id)
                    ? { ...doc, question_gen_status: "processing" }
                    : doc
                }
                stats={statsMap[doc.id] ?? null}
                onClick={() => navigate(`/quiz/doc/${doc.id}`)}
                onDelete={(e) => {
                  e.stopPropagation()
                  setDeleteError(null)
                  setDeleteTarget(doc)
                }}
              />
            ))}
          </div>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建资料组</DialogTitle>
          </DialogHeader>
          <input
            className="w-full h-10 px-3 rounded-lg border border-line-soft bg-surface text-body"
            placeholder="例如：英语真题"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreateGroup()
            }}
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={creating}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleCreateGroup()}
              disabled={creating || !newGroupName.trim()}
              style={{ color: "#FFFFFF" }}
            >
              {creating ? "创建中..." : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deleting) {
            setDeleteTarget(null)
            setDeleteError(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除资料？</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除「{deleteTarget?.name}」，包括原文、分段、图片、向量索引、题库、刷题记录、伴学对话与 Tip。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p className="text-small text-danger px-1">{deleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void handleConfirmDelete()
              }}
              disabled={deleting}
              className="bg-danger text-white hover:bg-danger/90"
            >
              {deleting ? "删除中..." : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  )
}
