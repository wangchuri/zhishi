import { useState } from "react"
import { Navigate, useNavigate } from "react-router-dom"
import { useAuth } from "@/context/AuthContext"
import { Mail, Lock, User, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"

export function LoginPage() {
  const { login, register, user, isLoading } = useAuth()
  const navigate = useNavigate()
  const [isRegister, setIsRegister] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [nickname, setNickname] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-ink">
        <div className="text-body text-mist">加载中...</div>
      </div>
    )
  }

  if (user) {
    return <Navigate to="/" replace />
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      if (isRegister) {
        await register(email, password, nickname || email.split("@")[0])
      } else {
        await login(email, password)
      }
      navigate("/")
    } catch (err: any) {
      setError(err.message || "操作失败，请重试")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-full flex items-center justify-center bg-ink"
      style={{
        backgroundImage: `radial-gradient(ellipse at 50% 20%, rgba(47, 138, 134, 0.15) 0%, transparent 60%)`,
      }}
    >
      <div className="w-full max-w-[440px] mx-auto animate-page-in">
        {/* 品牌区：扉页感 */}
        <div className="text-center mb-10">
          <h1 className="font-display text-display-xl text-paper">知拾</h1>
          <p className="text-caption text-mist tracking-[0.16em] uppercase mt-2">self-learning companion</p>
        </div>

        {/* Card：纸色面板 */}
        <div className="bg-paper rounded-[4px] border border-line p-8">
          <h2 className="font-display text-display-m text-ink mb-6">
            {isRegister ? "创建账号" : "欢迎回来"}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegister && (
              <div className="space-y-1.5">
                <label className="text-caption text-ink-soft">昵称</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-disabled" strokeWidth={2} />
                  <input
                    type="text"
                    value={nickname}
                    onChange={e => setNickname(e.target.value)}
                    placeholder="你的昵称"
                    required
                    className={cn(
                      "w-full h-10 pl-10 pr-3 rounded-[4px] border border-line bg-paper-2",
                      "text-body text-ink placeholder:text-ink-disabled",
                      "focus:border-sea focus:ring-1 focus:ring-sea-subtle outline-none transition-all"
                    )}
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-caption text-ink-soft">邮箱</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-disabled" strokeWidth={2} />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  autoComplete="username"
                  required
                  className={cn(
                    "w-full h-10 pl-10 pr-3 rounded-[4px] border border-line bg-paper-2",
                    "text-body text-ink placeholder:text-ink-disabled",
                    "focus:border-sea focus:ring-1 focus:ring-sea-subtle outline-none transition-all"
                  )}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-caption text-ink-soft">密码</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-disabled" strokeWidth={2} />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="至少 6 位"
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  required
                  minLength={6}
                  className={cn(
                    "w-full h-10 pl-10 pr-3 rounded-[4px] border border-line bg-paper-2",
                    "text-body text-ink placeholder:text-ink-disabled",
                    "focus:border-sea focus:ring-1 focus:ring-sea-subtle outline-none transition-all"
                  )}
                />
              </div>
            </div>

            {error && (
              <div className="text-small text-danger bg-danger-soft px-3 py-2.5 rounded-[4px] border border-danger/20">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className={cn(
                "w-full h-11 rounded-full text-body font-medium transition-all duration-150",
                loading ? "bg-ink-disabled text-paper cursor-not-allowed" : "bg-ink text-paper hover:bg-sea",
              )}
            >
              {loading ? (
                isRegister ? "正在创建..." : "登录中..."
              ) : (
                <span className="inline-flex items-center gap-2">
                  {isRegister ? "注册" : "登录"}
                  <ArrowRight className="w-4 h-4" strokeWidth={2} />
                </span>
              )}
            </button>

            <div className="text-center text-caption text-ink-disabled pt-1">
              {isRegister ? "已有账号？" : "还没有账号？"}
              <button
                type="button"
                onClick={() => { setIsRegister(!isRegister); setError("") }}
                className="text-sea hover:underline ml-1 font-medium"
              >
                {isRegister ? "去登录" : "去注册"}
              </button>
            </div>
          </form>
        </div>

        <p className="text-center text-caption text-mist mt-5">
          注册即自动创建专属知识库
        </p>
      </div>
    </div>
  )
}