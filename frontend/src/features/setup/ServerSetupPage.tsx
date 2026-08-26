import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Server, CheckCircle2, XCircle, Loader2, ArrowRight, RefreshCw, User } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  getStoredApiBase,
  setApiBase,
  checkServerHealth,
  getStoredNickname,
  setStoredNickname,
  hasNickname,
} from "@/lib/api"
import { useAuth } from "@/context/AuthContext"
import { AppLogo } from "@/components/layout/AppLogo"

type HealthState = "idle" | "checking" | "ok" | "error"

export function ServerSetupPage() {
  const navigate = useNavigate()
  const { setNickname } = useAuth()
  const [input, setInput] = useState(getStoredApiBase())
  const [nickname, setNicknameInput] = useState(getStoredNickname())
  const [healthState, setHealthState] = useState<HealthState>("idle")
  const [healthMessage, setHealthMessage] = useState("")
  const [saved, setSaved] = useState(false)
  const [nicknameSet, setNicknameSet] = useState(hasNickname())

  useEffect(() => {
    const stored = getStoredApiBase()
    if (stored) {
      setInput(stored)
    }
  }, [])

  const handleCheck = async () => {
    if (!input.trim()) {
      setHealthState("error")
      setHealthMessage("请输入服务器地址")
      return
    }
    setHealthState("checking")
    setHealthMessage("正在检测服务器...")
    const result = await checkServerHealth(input)
    if (result.ok) {
      setHealthState("ok")
    } else {
      setHealthState("error")
    }
    setHealthMessage(result.message)
  }

  const handleConnect = () => {
    setApiBase(input)
    // 没有昵称时先保存昵称
    if (!hasNickname() && nickname.trim()) {
      setStoredNickname(nickname)
    }
    setNickname(nickname.trim() || getStoredNickname())
    setNicknameSet(true)
    setSaved(true)
    setTimeout(() => navigate("/"), 600)
  }

  return (
    <div className="h-full flex items-center justify-center bg-ink"
      style={{
        backgroundImage: `radial-gradient(ellipse at 50% 20%, rgba(47, 138, 134, 0.15) 0%, transparent 60%)`,
      }}
    >
      <div className="w-full max-w-[440px] mx-auto animate-page-in">
        <div className="text-center mb-10">
          <AppLogo size="lg" className="mx-auto mb-4" />
          <h1 className="font-display text-display-xl text-paper">知拾</h1>
          <p className="text-caption text-mist tracking-[0.16em] uppercase mt-2">self-learning companion</p>
        </div>

        <div className="bg-paper rounded-[4px] border border-line p-8">
          <div className="flex items-center gap-2.5 mb-2">
            <Server className="w-5 h-5 text-sea" strokeWidth={2} />
            <h2 className="font-display text-display-m text-ink">连接服务器</h2>
          </div>
          <p className="text-caption text-ink-soft mb-6 leading-relaxed">
            输入你的知拾服务器 IP 或域名（例如 192.168.1.100:8765），
            应用会自动保存并尝试连接。
          </p>

          <div className="space-y-4">
            <input
              type="text"
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                setHealthState("idle")
                setHealthMessage("")
              }}
              placeholder="192.168.1.100:8765"
              className={cn(
                "w-full h-10 px-3 rounded-[4px] border bg-paper-2 text-body text-ink",
                "placeholder:text-ink-disabled focus:border-sea focus:ring-1 focus:ring-sea-subtle outline-none transition-all",
                healthState === "ok" ? "border-success" : "border-line"
              )}
            />

            {/* 昵称：服务器无名字时才让用户填写 */}
            {!nicknameSet && (
              <div>
                <div className="flex items-center gap-1.5 mb-1 text-caption text-ink-soft">
                  <User className="w-3.5 h-3.5" strokeWidth={2} />
                  给自己取一个名字（可选）
                </div>
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNicknameInput(e.target.value)}
                  placeholder="例如：小明"
                  maxLength={20}
                  className={cn(
                    "w-full h-10 px-3 rounded-[4px] border bg-paper-2 text-body text-ink",
                    "placeholder:text-ink-disabled focus:border-sea focus:ring-1 focus:ring-sea-subtle outline-none transition-all border-line"
                  )}
                />
              </div>
            )}

            {healthState !== "idle" && (
              <div className={cn(
                "text-small px-3 py-2.5 rounded-[4px] border flex items-start gap-2",
                healthState === "ok" && "bg-success-soft border-success/20 text-success",
                healthState === "error" && "bg-danger-soft border-danger/20 text-danger",
                healthState === "checking" && "bg-info-soft border-info/20 text-ink-soft"
              )}>
                {healthState === "checking" ? (
                  <Loader2 className="w-4 h-4 animate-spin shrink-0 mt-0.5" strokeWidth={2} />
                ) : healthState === "ok" ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={2} />
                ) : (
                  <XCircle className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={2} />
                )}
                <div>{healthMessage}</div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleCheck}
                disabled={healthState === "checking"}
                className={cn(
                  "flex-1 h-11 rounded-full text-body font-medium transition-all duration-150 inline-flex items-center justify-center gap-2",
                  healthState === "checking"
                    ? "bg-ink-disabled text-paper cursor-not-allowed"
                    : "bg-paper-2 border border-line text-ink hover:border-sea hover:text-sea"
                )}
              >
                <RefreshCw className={cn("w-4 h-4", healthState === "checking" && "animate-spin")} strokeWidth={2} />
                检测
              </button>
              <button
                onClick={handleConnect}
                disabled={healthState !== "ok"}
                className={cn(
                  "flex-1 h-11 rounded-full text-body font-medium transition-all duration-150 inline-flex items-center justify-center gap-2",
                  healthState === "ok"
                    ? "bg-ink text-paper hover:bg-sea"
                    : "bg-ink-disabled text-paper cursor-not-allowed"
                )}
              >
                {saved ? "已连接 ✓" : "进入应用"}
                {!saved && <ArrowRight className="w-4 h-4" strokeWidth={2} />}
              </button>
            </div>

            {healthState === "error" && (
              <p className="text-caption text-ink-disabled text-center leading-relaxed">
                请确认服务器已启动（端口 8765），且平板与服务器在同一网络
              </p>
            )}
          </div>
        </div>

        <p className="text-center text-caption text-mist mt-5">
          连接后自动检测服务器运行状态
        </p>
      </div>
    </div>
  )
}