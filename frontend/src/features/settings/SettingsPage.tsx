import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Server, Wifi, WifiOff, UserRound, Sparkles, Terminal, Trash2, FolderOpen } from "lucide-react"
import { toast } from "sonner"
import { AppShell } from "@/components/layout/AppShell"
import { PageHeader } from "@/components/blocks/PageHeader"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/context/AuthContext"
import { getStoredApiBase, profileApi, tasksApi } from "@/lib/api"
import { cn } from "@/lib/utils"

const MAX_UI_LOG_LINES = 2000

export function SettingsPage() {
  const navigate = useNavigate()
  const { server, setNickname } = useAuth()
  const apiBase = getStoredApiBase()
  const isDesktop = Boolean(window.zhishi?.isElectron)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [nickname, setNicknameDraft] = useState("")
  const [role, setRole] = useState("")
  const [goalText, setGoalText] = useState("")
  const [tinaStyle, setTinaStyle] = useState<"default" | "tsundere">("default")

  const [backendLogs, setBackendLogs] = useState<string[]>([])
  const [logFile, setLogFile] = useState("")
  const [backendManaged, setBackendManaged] = useState(false)
  const [backendRunning, setBackendRunning] = useState(false)
  const logEndRef = useRef<HTMLDivElement>(null)
  const logBoxRef = useRef<HTMLPreElement>(null)
  const stickToBottomRef = useRef(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    profileApi
      .get()
      .then((p) => {
        if (cancelled) return
        setNicknameDraft(p.nickname || "")
        setRole(p.role || "")
        setGoalText(p.goal?.text || "")
        setTinaStyle(p.tina_style === "tsundere" ? "tsundere" : "default")
      })
      .catch(() => {
        if (!cancelled) toast.error("加载档案失败")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!isDesktop || !window.zhishi?.getBackendLogs) return
    let unsub: (() => void) | undefined
    void window.zhishi.getBackendLogs().then((snap) => {
      setBackendLogs(snap.lines.slice(-MAX_UI_LOG_LINES))
      setLogFile(snap.logFile || "")
      setBackendManaged(snap.managed)
      setBackendRunning(snap.running)
    })
    unsub = window.zhishi.onBackendLog?.((line) => {
      setBackendLogs((prev) => {
        const next = [...prev, line]
        return next.length > MAX_UI_LOG_LINES ? next.slice(-MAX_UI_LOG_LINES) : next
      })
    })
    return () => {
      unsub?.()
    }
  }, [isDesktop])

  useEffect(() => {
    if (!stickToBottomRef.current) return
    logEndRef.current?.scrollIntoView({ behavior: "auto" })
  }, [backendLogs])

  const saveProfile = async () => {
    const name = nickname.trim()
    if (!name) {
      toast.error("请先填写称呼")
      return
    }
    setSaving(true)
    try {
      await profileApi.put({
        nickname: name,
        role: role.trim() || "",
        tina_style: tinaStyle,
      })
      setNickname(name)
      const goal = goalText.trim()
      if (goal) {
        await tasksApi.putGoal({ text: goal })
      }
      toast.success("已保存")
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  const clearLogs = async () => {
    await window.zhishi?.clearBackendLogs?.()
    setBackendLogs([])
  }

  const openLogFile = async () => {
    const res = await window.zhishi?.openBackendLogFile?.()
    if (res && !res.ok) toast.error(res.message || "无法打开日志文件")
  }

  return (
    <AppShell maxWidth={720}>
      <PageHeader title="设置" subtitle="个人信息和连接" />

      <div className="space-y-5">
        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-line-light bg-paper-2/50">
            <div className="w-8 h-8 rounded-md bg-sea-subtle text-sea flex items-center justify-center">
              <UserRound className="w-4 h-4" strokeWidth={2} />
            </div>
            <h3 className="text-card-title font-semibold text-ink">个人信息</h3>
          </div>
          <div className="p-5 space-y-4">
            {loading ? (
              <p className="text-body text-ink-soft">加载中…</p>
            ) : (
              <>
                <Field label="称呼">
                  <Input
                    value={nickname}
                    onChange={(e) => setNicknameDraft(e.target.value)}
                    placeholder="Tina 怎么叫你"
                    maxLength={40}
                  />
                </Field>
                <Field label="身份（可选）">
                  <Input
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    placeholder="例如：考研党、在职学习"
                    maxLength={80}
                  />
                </Field>
                <Field label="学习目标">
                  <textarea
                    value={goalText}
                    onChange={(e) => setGoalText(e.target.value)}
                    rows={3}
                    placeholder="写清楚你想达成什么，任务会按这个排"
                    className="w-full resize-none rounded-md bg-paper border border-line px-3.5 py-2.5 text-body text-ink placeholder:text-ink-disabled focus:outline-none focus:border-sea focus:ring-1 focus:ring-sea-subtle"
                  />
                </Field>
                <div className="flex justify-end">
                  <Button onClick={() => void saveProfile()} disabled={saving || loading}>
                    {saving ? "保存中…" : "保存信息"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-line-light bg-paper-2/50">
            <div className="w-8 h-8 rounded-md bg-sea-subtle text-sea flex items-center justify-center">
              <Sparkles className="w-4 h-4" strokeWidth={2} />
            </div>
            <h3 className="text-card-title font-semibold text-ink">Tina 说话风格</h3>
          </div>
          <div className="p-5 space-y-3">
            <p className="text-small text-ink-soft">
              对话里发 <span className="font-mono text-ink">/tina</span> 只会影响
              <span className="text-ink">当前会话</span>
              （含颜文字本体）；新开对话默认恢复正常语气。这里的选项是偏好备份，不自动套到所有聊天。
            </p>
            <div className="flex gap-2">
              {(
                [
                  { value: "default" as const, label: "默认" },
                  { value: "tsundere" as const, label: "傲娇缇娜" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={loading || saving}
                  onClick={() => setTinaStyle(opt.value)}
                  className={cn(
                    "h-9 px-3.5 rounded-full text-small font-medium border transition-colors",
                    tinaStyle === opt.value
                      ? "bg-sea text-paper border-sea"
                      : "bg-paper border-line text-ink-soft hover:border-sea/40 hover:text-sea",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="flex justify-end">
              <Button
                variant="secondary"
                disabled={loading || saving}
                onClick={() => void saveProfile()}
              >
                保存风格
              </Button>
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-line-light bg-paper-2/50">
            <div className="w-8 h-8 rounded-md bg-sea-subtle text-sea flex items-center justify-center">
              <Server className="w-4 h-4" strokeWidth={2} />
            </div>
            <h3 className="text-card-title font-semibold text-ink">服务器</h3>
          </div>
          <div className="divide-y divide-line-light">
            <Row
              icon={server.ok ? Wifi : WifiOff}
              title="后端地址"
              desc={apiBase || (isDesktop ? "桌面模式 · 本机 7777" : "未配置")}
              control={
                <button
                  type="button"
                  onClick={() => navigate("/setup")}
                  className="rounded-full border border-line px-3 h-8 text-small text-ink-soft hover:border-sea hover:text-sea transition-colors"
                >
                  重新配置
                </button>
              }
            />
            <Row
              icon={server.ok ? Wifi : WifiOff}
              title="连接状态"
              desc={server.message || "检测中…"}
              control={
                server.ok ? <Badge variant="success">正常</Badge> : <Badge variant="neutral">异常</Badge>
              }
            />
          </div>
        </Card>

        {isDesktop && (
          <Card className="overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-3.5 border-b border-line-light bg-paper-2/50">
              <div className="w-8 h-8 rounded-md bg-sea-subtle text-sea flex items-center justify-center">
                <Terminal className="w-4 h-4" strokeWidth={2} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-card-title font-semibold text-ink">后端日志</h3>
                <p className="text-caption text-ink-soft truncate">
                  {backendManaged || backendRunning
                    ? "Electron 托管的后端实时输出"
                    : "若后端非本窗口拉起，可能看不到管道日志"}
                  {logFile ? ` · ${logFile}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {backendRunning ? (
                  <Badge variant="success">运行中</Badge>
                ) : (
                  <Badge variant="neutral">未托管</Badge>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  className="h-8 px-2.5"
                  onClick={() => void openLogFile()}
                  title="打开日志文件"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-8 px-2.5"
                  onClick={() => void clearLogs()}
                  title="清空显示"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            <div className="p-3">
              <pre
                ref={logBoxRef}
                onScroll={() => {
                  const el = logBoxRef.current
                  if (!el) return
                  stickToBottomRef.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 48
                }}
                className="h-64 overflow-auto rounded-md bg-ink text-[11px] leading-relaxed text-mist p-3 font-mono whitespace-pre-wrap break-all"
              >
                {backendLogs.length === 0
                  ? "（暂无日志。启动后端后，stdout/stderr 会显示在这里。）"
                  : backendLogs.join("\n")}
                <div ref={logEndRef} />
              </pre>
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-small text-ink-soft mb-1.5 font-medium">{label}</label>
      {children}
    </div>
  )
}

function Row({
  icon: Icon,
  title,
  desc,
  control,
  onClick,
}: {
  icon: typeof Server
  title: string
  desc: string
  control: React.ReactNode
  onClick?: () => void
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-5 py-3.5",
        onClick && "cursor-pointer hover:bg-paper-2 transition-colors",
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
    >
      <Icon className="w-[18px] h-[18px] text-ink-disabled shrink-0" strokeWidth={2} />
      <div className="flex-1 min-w-0">
        <div className="text-body text-ink font-medium">{title}</div>
        <div className="text-small text-ink-soft truncate">{desc}</div>
      </div>
      {control}
    </div>
  )
}
