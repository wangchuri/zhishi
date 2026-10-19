import { useCallback, useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import {
  ArrowLeft,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquare,
  Play,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { AppShell } from "@/components/layout/AppShell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MarkdownWithMath } from "@/components/blocks/MarkdownWithMath"
import { MessageImages } from "@/components/blocks/ImageAttachments"
import { TutorPanel } from "@/features/tutor/TutorPanel"
import { QuizQuestionReflection } from "./QuizQuestionReflection"
import { QUESTION_TYPE_LABEL } from "./quizQuestionUtils"
import { getApiBase, quizApi } from "@/lib/api"
import type { QuestionAnswerRecord, QuestionHistory } from "@/types"

type BadgeVariant = "success" | "danger" | "warning" | "neutral"

const STATUS_META: Record<string, { label: string; variant: BadgeVariant }> = {
  correct: { label: "答对", variant: "success" },
  wrong: { label: "答错", variant: "danger" },
  unknown: { label: "不会", variant: "warning" },
  partial: { label: "部分对", variant: "warning" },
}

function statusMeta(status?: string | null) {
  return STATUS_META[status || ""] || { label: status || "—", variant: "neutral" as BadgeVariant }
}

function fmtTime(iso?: string | null): string {
  if (!iso) return ""
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return ""
  }
}

function fmtDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return ""
  if (seconds < 60) return `${seconds} 秒`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s ? `${m} 分 ${s} 秒` : `${m} 分钟`
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line-soft bg-paper px-3 py-2">
      <div className="text-caption text-ink-tertiary">{label}</div>
      <div className="text-title-s text-ink tabular-nums">{value}</div>
    </div>
  )
}

/**
 * 题目详情主体：题干 + 答案 + 解析 + 累计统计 + 历次作答 + 感想 + 来源。
 *
 * 抽成组件是为了两处复用：单题整页（QuizQuestionDetailPage），
 * 以及「左边题目列表、右边详情」的题目页（QuizQuestionListPage）。
 */
export function QuestionDetailBody({ questionId }: { questionId: string }) {
  const [data, setData] = useState<QuestionHistory | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    if (!questionId) return
    setLoading(true)
    setError("")
    try {
      setData(await quizApi.questionHistory(questionId))
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [questionId])

  useEffect(() => {
    void load()
  }, [load])

  const question = data?.question
  const stats = data?.stats
  const provenance = data?.provenance || []
  const answers = data?.answers || []
  const imageBaseDocId = provenance.find((p) => p.document_id)?.document_id
  const imageBase = imageBaseDocId
    ? `${getApiBase().replace(/\/$/, "")}/api/v1/kb/documents/${encodeURIComponent(imageBaseDocId)}/images`
    : undefined

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-body text-ink-soft py-16 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" />
        加载中…
      </div>
    )
  }
  if (error || !question) {
    return (
      <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-body text-ink">
        {error || "题目不存在"}
      </div>
    )
  }

  return (
    <>
      {/* 题目 */}
      <section className="rounded-xl border border-line bg-paper p-4 md:p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="neutral">
            {QUESTION_TYPE_LABEL[question.question_type] || question.question_type}
          </Badge>
          {stats?.last_status ? (
            <Badge variant={statusMeta(stats.last_status).variant}>
              上次 {statusMeta(stats.last_status).label}
            </Badge>
          ) : (
            <Badge variant="neutral">未做</Badge>
          )}
          {(question.tags || []).map((t) => (
            <Badge key={t} variant="neutral">
              {t}
            </Badge>
          ))}
        </div>

        <MarkdownWithMath imageBaseUrl={imageBase}>
          {question.stem}
        </MarkdownWithMath>

        {question.options && question.options.length > 0 && (
          <div className="space-y-1">
            {question.options.map((o) => (
              <div key={o.key} className="text-body text-ink-primary">
                <span className="text-ink-tertiary mr-1.5">{o.key}.</span>
                <MarkdownWithMath
                  proseClass="prose prose-sm max-w-none inline prose-p:inline prose-p:my-0 prose-p:text-inherit"
                  className="inline"
                  imageBaseUrl={imageBase}
                >
                  {o.text}
                </MarkdownWithMath>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-lg border border-success/25 bg-success/10 p-3">
          <div className="text-caption text-ink-tertiary mb-1">正确答案</div>
          <MarkdownWithMath imageBaseUrl={imageBase}>
            {question.answer || "—"}
          </MarkdownWithMath>
        </div>

        {question.explanation && (
          <div className="rounded-lg border border-line-soft bg-surface-soft p-3">
            <div className="text-caption text-ink-tertiary mb-1">解析</div>
            <MarkdownWithMath imageBaseUrl={imageBase}>
              {question.explanation}
            </MarkdownWithMath>
          </div>
        )}
      </section>

      {/* 累计统计 */}
      {stats && (
        <section className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatCell label="作答次数" value={String(stats.attempt_count)} />
          <StatCell label="答对" value={String(stats.correct_count)} />
          <StatCell
            label="正确率"
            value={stats.accuracy_rate == null ? "—" : `${Math.round(stats.accuracy_rate * 100)}%`}
          />
          <StatCell label="当前连对" value={String(stats.current_streak ?? 0)} />
        </section>
      )}

      {/* 作答记录 */}
      <section className="mt-6">
        <h2 className="text-card-title font-semibold text-ink mb-3">
          作答记录{answers.length ? `（${answers.length}）` : ""}
        </h2>
        {answers.length === 0 ? (
          <p className="text-small text-ink-tertiary">还没答过这道题。</p>
        ) : (
          <div className="space-y-3">
            {answers.map((a: QuestionAnswerRecord) => {
              const meta = statusMeta(a.status)
              return (
                <div key={a.id} className="rounded-xl border border-line-soft bg-paper p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                    {a.grade_method === "ai" && (
                      <span className="text-caption text-ink-tertiary">AI 判题</span>
                    )}
                    {fmtDuration(a.time_spent_seconds) && (
                      <span className="text-caption text-ink-tertiary">
                        用时 {fmtDuration(a.time_spent_seconds)}
                      </span>
                    )}
                    <span className="ml-auto text-caption text-ink-tertiary">
                      {fmtTime(a.answered_at)}
                    </span>
                  </div>

                  {a.attachments && a.attachments.length > 0 && (
                    <MessageImages ids={a.attachments} />
                  )}

                  {a.user_answer && (
                    <div className="text-small text-ink-primary whitespace-pre-wrap break-words">
                      你的答案：{a.user_answer}
                    </div>
                  )}

                  {a.ai_reason && (
                    <div className="text-small text-ink-soft rounded-md border border-line-soft bg-surface-soft px-3 py-2">
                      <span className="text-ink-tertiary">AI 评语：</span>
                      {a.ai_reason}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* 感想（只增不改，同时进 tip） */}
      <section className="mt-6">
        <QuizQuestionReflection
          questionId={question.id}
          documentId={imageBaseDocId || undefined}
        />
      </section>

      {/* 来源 */}
      {provenance.length > 0 && (
        <section className="mt-6">
          <h2 className="text-card-title font-semibold text-ink mb-3">来自</h2>
          <div className="space-y-2">
            {provenance.map((p, i) => (
              <Link
                key={`${p.document_id || "unknown"}-${i}`}
                to={p.document_id ? `/knowledge/doc/${p.document_id}` : "/quiz"}
                className="flex items-center gap-2 rounded-lg border border-line-soft bg-paper px-3 py-2 hover:border-sea/40 transition-colors"
              >
                <FileText className="w-4 h-4 text-ink-tertiary shrink-0" strokeWidth={2} />
                <span className="flex-1 truncate text-small text-ink-primary">
                  {p.document_name || p.document_id || "未知来源"}
                </span>
                {p.page_number ? (
                  <span className="text-caption text-ink-tertiary shrink-0">
                    第 {p.page_number} 页
                  </span>
                ) : null}
                <ExternalLink className="w-3.5 h-3.5 text-ink-tertiary shrink-0" strokeWidth={2} />
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

/** 单题详情整页：题目 + 累计统计 + 历次作答（含拍照）+ 思路 + 来源。 */
export function QuizQuestionDetailPage() {
  const { questionId = "" } = useParams()
  const navigate = useNavigate()
  const [tutorOpen, setTutorOpen] = useState(false)
  const [starting, setStarting] = useState(false)

  const startDrill = async () => {
    setStarting(true)
    try {
      const session = await quizApi.createSession({ question_ids: [questionId] })
      navigate(`/quiz/session?session_id=${session.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "无法开始刷题")
    } finally {
      setStarting(false)
    }
  }

  return (
    <AppShell maxWidth={1180} noPadding>
      <div className="flex h-full">
        <div className="flex-1 min-w-0 overflow-y-auto scroll-thin">
          <div className="p-4 md:p-6 max-w-[880px] mx-auto">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <Button variant="ghost" size="sm" onClick={() => navigate("/quiz")}>
                <ArrowLeft className="w-4 h-4" strokeWidth={2} />
                资料
              </Button>
              <div className="flex-1" />
              <Button variant="secondary" size="sm" onClick={() => void startDrill()} disabled={starting}>
                {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" strokeWidth={2} />}
                再刷一遍
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setTutorOpen(true)}>
                <MessageSquare className="w-4 h-4" strokeWidth={2} />
                问 Tina
              </Button>
            </div>

            <QuestionDetailBody questionId={questionId} />

            <div className="h-8" />
          </div>
        </div>

        {/* 问 Tina：手机全屏层 / 桌面右栏（按需挂载，避免白建会话） */}
        {tutorOpen && (
          <div className="fixed inset-0 z-[80] bg-paper flex flex-col lg:static lg:inset-auto lg:z-auto lg:w-[380px] lg:shrink-0 lg:border-l lg:border-line pt-[env(safe-area-inset-top)] lg:pt-0 pb-[env(safe-area-inset-bottom)] lg:pb-0">
            <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-line lg:hidden">
              <span className="flex-1 text-card-title font-semibold text-ink">问 Tina 这道题</span>
              <button
                type="button"
                onClick={() => setTutorOpen(false)}
                className="w-8 h-8 rounded-md flex items-center justify-center text-ink-soft"
                aria-label="关闭"
              >
                <X className="w-4 h-4" strokeWidth={2} />
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <TutorPanel questionId={questionId} className="h-full rounded-none border-0" />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
