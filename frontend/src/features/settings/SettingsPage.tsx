import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Server, Wifi, WifiOff, UserRound, Sparkles, ListTodo, FileScan } from "lucide-react"
import { toast } from "sonner"
import { AppShell } from "@/components/layout/AppShell"
import { PageHeader } from "@/components/blocks/PageHeader"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/context/AuthContext"
import { getStoredApiBase, profileApi, systemApi, tasksApi, type MineruSettings } from "@/lib/api"
import { cn } from "@/lib/utils"

export function SettingsPage() {
  const navigate = useNavigate()
  const { server, setNickname } = useAuth()
  const apiBase = getStoredApiBase()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [nickname, setNicknameDraft] = useState("")
  const [role, setRole] = useState("")
  const [goalText, setGoalText] = useState("")
  const [tinaStyle, setTinaStyle] = useState<"default" | "tsundere">("default")
  const [taskMaxCount, setTaskMaxCount] = useState("")
  const [taskMaxMinutes, setTaskMaxMinutes] = useState("")
  const [savingTasks, setSavingTasks] = useState(false)

  const [mineruMode, setMineruMode] = useState<"local" | "cloud">("local")
  const [mineruToken, setMineruToken] = useState("")
  const [mineruBase, setMineruBase] = useState("https://mineru.net")
  const [mineruModel, setMineruModel] = useState<"pipeline" | "vlm">("vlm")
  const [mineruConfigPath, setMineruConfigPath] = useState("")
  const [savingMineru, setSavingMineru] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([profileApi.get(), systemApi.getMineru().catch(() => null)])
      .then(([p, mineru]) => {
        if (cancelled) return
        setNicknameDraft(p.nickname || "")
        setRole(p.role || "")
        setGoalText(p.goal?.text || "")
        setTinaStyle(p.tina_style === "tsundere" ? "tsundere" : "default")
        setTaskMaxCount(p.task_max_daily_count && p.task_max_daily_count > 0 ? String(p.task_max_daily_count) : "")
        setTaskMaxMinutes(
          p.task_max_study_minutes && p.task_max_study_minutes > 0 ? String(p.task_max_study_minutes) : "",
        )
        if (mineru) {
          applyMineru(mineru)
        }
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

  const applyMineru = (m: MineruSettings) => {
    setMineruMode(m.mode === "cloud" ? "cloud" : "local")
    setMineruToken(m.api_token || "")
    setMineruBase(m.api_base || "https://mineru.net")
    setMineruModel(m.model_version === "pipeline" ? "pipeline" : "vlm")
    setMineruConfigPath(m.config_path || "")
  }
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

  const saveTaskLimits = async () => {
    const parseLimit = (raw: string, label: string): number | null | undefined => {
      const t = raw.trim()
      if (!t) return 0
      const n = Number(t)
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
        toast.error(`${label}请填非负整数，留空表示不限制`)
        return undefined
      }
      return n
    }
    const count = parseLimit(taskMaxCount, "每日任务上限")
    if (count === undefined) return
    const minutes = parseLimit(taskMaxMinutes, "学习时长上限")
    if (minutes === undefined) return
    setSavingTasks(true)
    try {
      await profileApi.put({
        task_max_daily_count: count,
        task_max_study_minutes: minutes,
      })
      toast.success("任务偏好已保存")
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSavingTasks(false)
    }
  }

  const saveMineru = async () => {
    if (mineruMode === "cloud" && !mineruToken.trim()) {
      toast.error("云端模式需要填写 API Token")
      return
    }
    setSavingMineru(true)
    try {
      const saved = await systemApi.putMineru({
        mode: mineruMode,
        api_token: mineruToken.trim(),
        api_base: mineruBase.trim() || "https://mineru.net",
        model_version: mineruModel,
      })
      applyMineru(saved)
      toast.success("MinerU 配置已写入服务器配置文件")
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSavingMineru(false)
    }
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
              <ListTodo className="w-4 h-4" strokeWidth={2} />
            </div>
            <h3 className="text-card-title font-semibold text-ink">任务偏好</h3>
          </div>
          <div className="p-5 space-y-4">
            <p className="text-small text-ink-soft">
              给任务 Agent 设硬上限。留空表示不限制，仍由 Agent 根据目标和学情自行决定。
            </p>
            {loading ? (
              <p className="text-body text-ink-soft">加载中…</p>
            ) : (
              <>
                <Field label="每日最多布置几条任务">
                  <Input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={taskMaxCount}
                    onChange={(e) => setTaskMaxCount(e.target.value)}
                    placeholder="例如 3；留空不限制"
                  />
                </Field>
                <Field label="今日学习满多少分钟后不再布置">
                  <Input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={taskMaxMinutes}
                    onChange={(e) => setTaskMaxMinutes(e.target.value)}
                    placeholder="例如 90；留空不限制"
                  />
                </Field>
                <div className="flex justify-end">
                  <Button
                    variant="secondary"
                    disabled={loading || savingTasks}
                    onClick={() => void saveTaskLimits()}
                  >
                    {savingTasks ? "保存中…" : "保存任务偏好"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-line-light bg-paper-2/50">
            <div className="w-8 h-8 rounded-md bg-sea-subtle text-sea flex items-center justify-center">
              <FileScan className="w-4 h-4" strokeWidth={2} />
            </div>
            <h3 className="text-card-title font-semibold text-ink">MinerU 文档解析</h3>
          </div>
          <div className="p-5 space-y-4">
            <p className="text-small text-ink-soft">
              扫描件 / 图片 PDF 走 MinerU。本地模式拉起本机 mineru-api（无需 Token）；云端模式调用 mineru.net，需在官网创建 Token。云端超过 200 页或 200MB 时会自动拆段上传再合并。保存后写入服务器{" "}
              <span className="font-mono text-ink">config.yml</span>。
            </p>
            {loading ? (
              <p className="text-body text-ink-soft">加载中…</p>
            ) : (
              <>
                <div>
                  <div className="text-small text-ink-soft mb-1.5 font-medium">解析方式</div>
                  <div className="flex gap-2">
                    {(
                      [
                        { value: "local" as const, label: "本地 mineru-api" },
                        { value: "cloud" as const, label: "云端 mineru.net" },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={savingMineru}
                        onClick={() => setMineruMode(opt.value)}
                        className={cn(
                          "h-9 px-3.5 rounded-full text-small font-medium border transition-colors",
                          mineruMode === opt.value
                            ? "bg-sea text-paper border-sea"
                            : "bg-paper border-line text-ink-soft hover:border-sea/40 hover:text-sea",
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {mineruMode === "cloud" ? (
                  <>
                    <Field label="API Token">
                      <Input
                        type="password"
                        autoComplete="off"
                        value={mineruToken}
                        onChange={(e) => setMineruToken(e.target.value)}
                        placeholder="在 mineru.net API 管理页创建"
                      />
                    </Field>
                    <Field label="API 地址">
                      <Input
                        value={mineruBase}
                        onChange={(e) => setMineruBase(e.target.value)}
                        placeholder="https://mineru.net"
                      />
                    </Field>
                    <div>
                      <div className="text-small text-ink-soft mb-1.5 font-medium">模型版本</div>
                      <div className="flex gap-2">
                        {(
                          [
                            { value: "vlm" as const, label: "vlm（推荐）" },
                            { value: "pipeline" as const, label: "pipeline" },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            disabled={savingMineru}
                            onClick={() => setMineruModel(opt.value)}
                            className={cn(
                              "h-9 px-3.5 rounded-full text-small font-medium border transition-colors",
                              mineruModel === opt.value
                                ? "bg-sea text-paper border-sea"
                                : "bg-paper border-line text-ink-soft hover:border-sea/40 hover:text-sea",
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-small text-ink-soft rounded-[4px] border border-line bg-paper-2 px-3 py-2.5">
                    本地模式不需要 Token。请确保本机已安装并可运行{" "}
                    <span className="font-mono text-ink">mineru-api</span>（首次解析会自动尝试拉起）。
                  </p>
                )}

                {mineruConfigPath ? (
                  <p className="text-caption text-ink-disabled break-all">配置文件：{mineruConfigPath}</p>
                ) : null}

                <div className="flex justify-end">
                  <Button
                    variant="secondary"
                    disabled={loading || savingMineru}
                    onClick={() => void saveMineru()}
                  >
                    {savingMineru ? "保存中…" : "保存 MinerU 配置"}
                  </Button>
                </div>
              </>
            )}
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
              desc={apiBase || "未配置（同源或默认）"}
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
