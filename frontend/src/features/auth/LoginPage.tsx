import { useState, type FormEvent } from "react"
import { Navigate, useNavigate } from "react-router-dom"
import { KeyRound, Loader2, LogIn, ShieldCheck, UserPlus } from "lucide-react"
import { cn } from "@/lib/utils"
import { isServerConfigured } from "@/lib/api"
import { useAuth } from "@/context/AuthContext"
import { AppLogo } from "@/components/layout/AppLogo"

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

  const inputClass = cn(
    "w-full h-10 px-3 rounded-[4px] border bg-paper-2 text-body text-ink",
    "placeholder:text-ink-disabled focus:border-sea focus:ring-1 focus:ring-sea-subtle outline-none transition-all border-line",
  )

  return (
    <div
      className="h-full flex items-center justify-center bg-ink"
      style={{
        backgroundImage: `radial-gradient(ellipse at 50% 20%, rgba(47, 138, 134, 0.15) 0%, transparent 60%)`,
      }}
    >
      <div className="w-full max-w-[440px] mx-auto animate-page-in">
        <div className="text-center mb-10">
          <AppLogo size="lg" className="mx-auto mb-4" />
          <h1 className="font-display text-display-xl text-paper">知拾</h1>
          <p className="text-caption text-mist tracking-[0.16em] uppercase mt-2">
            self-learning companion
          </p>
        </div>

        <div className="bg-paper rounded-[4px] border border-line p-8">
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
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="用户名"
              className={inputClass}
            />
            <input
              type="password"
              autoComplete={isSetup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码"
              className={inputClass}
            />
            {isSetup && (
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="确认密码"
                className={inputClass}
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
                "w-full h-11 rounded-full text-body font-medium transition-all duration-150 inline-flex items-center justify-center gap-2",
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
      </div>
    </div>
  )
}
