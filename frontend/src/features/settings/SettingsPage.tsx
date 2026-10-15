import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Server, Wifi, WifiOff, UserRound, Sparkles, ListTodo, FileScan, HardDrive } from "lucide-react"
import { toast } from "sonner"
import { AppShell } from "@/components/layout/AppShell"
import { PageHeader } from "@/components/blocks/PageHeader"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/context/AuthContext"
import { getStoredApiBase, profileApi, systemApi, tasksApi, uploadsApi, type MineruSettings } from "@/lib/api"
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

  // 图片缓存（对话 / 拍照作答上传的图，存在服务器本地）
  const [imgStats, setImgStats] = useState<{ count: number; bytes: number } | null>(null)
  const [imgBusy, setImgBusy] = useState(false)

  const loadImgStats = useCallback(async () => {
    try {
      setImgStats(await uploadsApi.stats())
    } catch {
      setImgStats(null)
    }
  }, [])

  useEffect(() => {
    void loadImgStats()
  }, [loadImgStats])

  const cleanupImages = async (days: number) => {
    const label = days > 0 ? `${days} 天前` : "全部"
    const ok = window.confirm(
      `确定清理${label}的图片吗？清理后历史消息、错题回顾里对应的图会显示不出来（已判分的结果不受影响）。`,
    )
    if (!ok) return
    setImgBusy(true)
    try {
      const res = await uploadsApi.cleanup(days)
      const mb = (res.freed_bytes / 1024 / 1024).toFixed(1)
      toast.success(`已清理 ${res.deleted} 张（释放 ${mb} MB）`)
      await loadImgStats()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "清理失败")
    } finally {
      setImgBusy(false)
    }
  }

  const [mineruMode, setMineruMode] = useState<"local" | "cloud">("local")
  const [mineruToken, setMineruToken] = useState("")
  const [mineruBase, setMineruBase] = useState("https://mineru.net")
  const [mineruModel, setMineruModel] = useState<"pipeline" | "vlm">("vlm")
  const [mineruPolicy, setMineruPolicy] = useState<"smart" | "all" | "scanned_only">("smart")
  const [mineruConfigPath, setMineruConfigPath] = useState("")
  const [mineruInstalled, setMineruInstalled] = useState(false)
  const [mineruAvailable, setMineruAvailable] = useState(false)
  const [mineruInstalling, setMineruInstalling] = useState(false)
  const [mineruInstallDir, setMineruInstallDir] = useState("")
  const [mineruLog, setMineruLog] = useState<string[]>([])
  const [mineruBusy, setMineruBusy] = useState(false)
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
    setMineruPolicy(m.pdf_parse_policy || "smart")
    setMineruConfigPath(m.config_path || "")
    setMineruInstalled(!!m.installed)
    setMineruAvailable(!!m.available)
    setMineruInstalling(!!m.installing)
    setMineruInstallDir(m.install_dir || "")
  }

  const startMineruInstall = async () => {
    setMineruBusy(true)
    try {
      const st = await systemApi.installMineru()
      setMineruInstalling(st.state === "installing")
      setMineruLog(st.log || [])
      toast.success("已开始安装 MinerU（独立环境，后台进行）")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "安装启动失败")
    } finally {
      setMineruBusy(false)
    }
  }

  const releaseMineru = async () => {
    setMineruBusy(true)
    try {
      await systemApi.releaseMineru()
      toast.success("已释放 MinerU 进程")
      const m = await systemApi.getMineru().catch(() => null)
      if (m) applyMineru(m)
    } finally {
      setMineruBusy(false)
    }
  }

  useEffect(() => {
    if (!mineruInstalling) return
    const timer = window.setInterval(() => {
      void systemApi
        .mineruInstallStatus()
        .then(async (st) => {
          setMineruLog(st.log || [])
          if (st.state !== "installing") {
            setMineruInstalling(false)
            const m = await systemApi.getMineru().catch(() => null)
            if (m) applyMineru(m)
            if (st.state === "done") toast.success("MinerU 安装完成，等待 OCR 的资料会自动重试")
            else if (st.state === "failed") toast.error("MinerU 安装失败，详情见日志")
          }
        })
        .catch(() => {})
    }, 2500)
    return () => window.clearInterval(timer)
  }, [mineruInstalling])
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
        pdf_parse_policy: mineruPolicy,
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
              <HardDrive className="w-4 h-4" strokeWidth={2} />
            </div>
            <h3 className="text-card-title font-semibold text-ink">图片缓存</h3>
          </div>
          <div className="p-5 space-y-3">
            <p className="text-small text-ink-soft">
              对话里发的图和拍照作答的图都存在服务器本地，不会自动清理。清掉之后，
              历史消息与错题回顾里对应的图会显示不出来 —— 但已判分的结论不受影响。
            </p>
            <div className="text-small text-ink">
              当前占用：
              {imgStats
                ? `${imgStats.count} 张 · ${(imgStats.bytes / 1024 / 1024).toFixed(1)} MB`
                : "统计中…"}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => void loadImgStats()} disabled={imgBusy}>
                刷新
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void cleanupImages(30)}
                disabled={imgBusy || !imgStats?.count}
              >
                {imgBusy ? "清理中…" : "清理 30 天前的"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void cleanupImages(0)}
                disabled={imgBusy || !imgStats?.count}
              >
                全部清理
              </Button>
            </div>
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
              扫描件 / 图片 PDF 走 MinerU；文本型 PDF 若公式/结构缺失（数学、理工卷子）也会按下方策略自动走 MinerU。本地模式拉起本机 mineru-api（无需 Token）；云端模式调用 mineru.net，需在官网创建 Token。云端超过 200 页或 200MB 时会自动拆段上传再合并。保存后写入服务器{" "}
              <span className="font-mono text-ink">config.yml</span>。
            </p>            {loading ? (
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

                <div>
                  <div className="text-small text-ink-soft mb-1.5 font-medium">PDF 解析策略</div>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        { value: "smart" as const, label: "智能（可疑走 MinerU）" },
                        { value: "all" as const, label: "全部 PDF 走 MinerU" },
                        { value: "scanned_only" as const, label: "仅扫描件" },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={savingMineru}
                        onClick={() => setMineruPolicy(opt.value)}
                        className={cn(
                          "h-9 px-3.5 rounded-full text-small font-medium border transition-colors",
                          mineruPolicy === opt.value
                            ? "bg-sea text-paper border-sea"
                            : "bg-paper border-line text-ink-soft hover:border-sea/40 hover:text-sea",
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-caption text-ink-tertiary mt-1.5">
                    公式/结构缺失的文本型 PDF（数学、理工卷子）在「智能」下会自动改用 MinerU（强制 OCR）转成带 LaTeX 的解析稿。
                  </p>
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
                  <div className="space-y-3">
                    <p className="text-small text-ink-soft rounded-[4px] border border-line bg-paper-2 px-3 py-2.5">
                      本地模式不需要 Token：按需才拉起 <span className="font-mono text-ink">mineru-api</span>（无任务不启动），空闲自动释放。未安装时可一键装到独立环境，不污染应用依赖。
                    </p>
                    <div className="rounded-[4px] border border-line bg-paper-2 px-3 py-2.5 space-y-2">
                      <div className="text-small text-ink-soft">
                        MinerU 状态：
                        {mineruInstalled
                          ? mineruAvailable
                            ? "已安装 · 运行中"
                            : "已安装 · 未运行（按需启动）"
                          : "未安装"}
                      </div>
                      {mineruInstallDir ? (
                        <div className="text-caption text-ink-disabled break-all">
                          安装目录：{mineruInstallDir}
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void startMineruInstall()}
                          disabled={mineruBusy || mineruInstalling}
                        >
                          {mineruInstalling
                            ? "安装中…"
                            : mineruInstalled
                              ? "重新安装 MinerU"
                              : "一键安装 MinerU（独立环境）"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void releaseMineru()}
                          disabled={mineruBusy}
                        >
                          释放进程
                        </Button>
                      </div>
                      {mineruLog.length > 0 ? (
                        <pre className="max-h-40 overflow-auto text-caption text-ink-tertiary bg-black/5 rounded p-2 whitespace-pre-wrap">
                          {mineruLog.slice(-12).join("\n")}
                        </pre>
                      ) : null}
                    </div>
                  </div>
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
