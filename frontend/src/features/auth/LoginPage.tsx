import { useState, type FormEvent } from "react"
import { Navigate, useNavigate } from "react-router-dom"
import { KeyRound, Loader2, LogIn, ShieldCheck, UserPlus } from "lucide-react"
import { cn } from "@/lib/utils"
import { isServerConfigured } from "@/lib/api"
import { useAuth } from "@/context/AuthContext"
import { AppLogo } from "@/components/layout/AppLogo"
import { AUTH_BUTTON_CLASS, AUTH_INPUT_CLASS, AuthScaffold } from "@/components/layout/AuthScaffold"

export function LoginPage() {
  const navigate = useNavigate()
  const { authPhase, login, setupAccount } = useAuth()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  if (!isServerConfigured()) return <Navigate to="/setup" replace />
  if (authPhase === "authed") return <Navigate to="/" replace />

  const isSetup = authPhase === "need_setup"

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError("")
    const name = username.trim()
    if (!name || !password) {
      setError("请输入用户名和密码")
      return
    }
    if (isSetup) {
      if (name.length < 3) return setError("用户名至少 3 个字符")
      if (password.length < 6) return setError("密码至少 6 位")
      if (password !== confirm) return setError("两次输入的密码不一致")
    }
    setBusy(true)
    try {
      if (isSetup) await setupAccount(name, password)
      else await login(name, password)
      navigate("/", { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败，请重试")
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthScaffold>
      <div className="text-center mb-7 sm:mb-10">
        <AppLogo size="lg" className="mx-auto mb-4" />
        <h1 className="font-display text-display-xl text-paper">知拾</h1>
        <p className="text-caption text-mist tracking-[0.16em] uppercase mt-2">
          self-learning companion
        </p>
      </div>

      <div className="bg-paper rounded-[4px] border border-line p-5 sm:p-8">
        <div className="flex items-center gap-2.5 mb-2">
          {isSetup ? (
            <ShieldCheck className="w-5 h-5 text-sea" strokeWidth={2} />
          ) : (
            <KeyRound className="w-5 h-5 text-sea" strokeWidth={2} />
          )}
          <h2 className="font-display text-display-m text-ink">
            {isSetup ? "创建管理员账号" : "登录"}
          </h2>
        </div>
        <p className="text-caption text-ink-soft mb-6 leading-relaxed">
          {isSetup
            ? "这是首次部署，请设置用于访问知拾的用户名和密码。"
            : "请输入用户名和密码进入知拾。"}
        </p>

        <form className="space-y-4" onSubmit={submit}>
          <input
            type="text"
            name="username"
            autoComplete="username"
            // 移动端键盘默认首字母大写 / 自动纠错 —— 会把用户名改成 Wangchuri 之类
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="用户名"
            className={AUTH_INPUT_CLASS}
          />
          <input
            type="password"
            name="password"
            autoComplete={isSetup ? "new-password" : "current-password"}
            enterKeyHint={isSetup ? "next" : "go"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="密码"
            className={AUTH_INPUT_CLASS}
          />
          {isSetup && (
            <input
              type="password"
              name="confirm-password"
              autoComplete="new-password"
              enterKeyHint="go"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="确认密码"
              className={AUTH_INPUT_CLASS}
            />
          )}

          {error && (
            <div className="text-small px-3 py-2.5 rounded-[4px] border bg-danger-soft border-danger/20 text-danger">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className={cn(
              AUTH_BUTTON_CLASS,
              "w-full",
              busy ? "bg-ink-disabled text-paper cursor-not-allowed" : "bg-ink text-paper hover:bg-sea",
            )}
          >
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
            ) : isSetup ? (
              <UserPlus className="w-4 h-4" strokeWidth={2} />
            ) : (
              <LogIn className="w-4 h-4" strokeWidth={2} />
            )}
            {busy ? "处理中…" : isSetup ? "创建并进入" : "登录"}
          </button>
        </form>
      </div>
    </AuthScaffold>
  )
}
