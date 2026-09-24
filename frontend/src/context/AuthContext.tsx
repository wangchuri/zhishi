import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react"
import {
  isServerConfigured,
  checkServerHealth,
  clearApiBase,
  getStoredNickname,
  setStoredNickname,
  profileApi,
  authApi,
  UNAUTHORIZED_EVENT,
} from "@/lib/api"

interface User {
  id: number
  email: string
  nickname: string
  username?: string
  is_active: boolean
}

interface ServerState {
  checked: boolean
  ok: boolean
  message: string
}

/** 登录状态机 */
export type AuthPhase = "unknown" | "need_setup" | "need_login" | "authed"

interface AuthState {
  user: User
  serverConfigured: boolean
  server: ServerState
  /** 登录状态：unknown=检测中 */
  authPhase: AuthPhase
  username: string | null
  /** 每次运行/进入应用时调用：检测当前服务器是否正常运行 */
  checkServer: () => Promise<boolean>
  /** 重新检测登录状态 */
  refreshAuth: () => Promise<AuthPhase>
  /** 首次创建管理员账号 */
  setupAccount: (username: string, password: string) => Promise<void>
  /** 登录 */
  login: (username: string, password: string) => Promise<void>
  /** 退出登录 */
  logout: () => Promise<void>
  /** 重新配置服务器地址（跳回设置页） */
  resetServer: () => void
  /** 设置本地昵称（有无名称时调用） */
  setNickname: (name: string) => void
}

const AuthContext = createContext<AuthState | null>(null)

const LOCAL_EMAIL = "local@zhishi.local"

export function AuthProvider({ children }: { children: ReactNode }) {
  const [serverConfigured] = useState<boolean>(() => isServerConfigured())
  const [server, setServer] = useState<ServerState>({
    checked: false,
    ok: false,
    message: "",
  })
  const [nickname, setNicknameState] = useState<string>(() => getStoredNickname())
  const [authPhase, setAuthPhase] = useState<AuthPhase>("unknown")
  const [username, setUsername] = useState<string | null>(null)

  const refreshAuth = useCallback(async (): Promise<AuthPhase> => {
    if (!isServerConfigured()) {
      setAuthPhase("unknown")
      return "unknown"
    }
    try {
      const s = await authApi.status()
      setUsername(s.username ?? null)
      const phase: AuthPhase = !s.configured
        ? "need_setup"
        : !s.authenticated
          ? "need_login"
          : "authed"
      setAuthPhase(phase)
      return phase
    } catch {
      setAuthPhase("unknown")
      return "unknown"
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!isServerConfigured()) {
      return
    }
    authApi
      .status()
      .then((s) => {
        if (cancelled) return
        setUsername(s.username ?? null)
        if (!s.configured) setAuthPhase("need_setup")
        else if (!s.authenticated) setAuthPhase("need_login")
        else setAuthPhase("authed")
      })
      .catch(() => {
        if (!cancelled) setAuthPhase("unknown")
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onUnauthorized = () => {
      // 会话失效：重新查状态，别盲目设 need_login（未初始化时还得留在创建账号页）
      void refreshAuth()
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [refreshAuth])

  const checkServer = useCallback(async (): Promise<boolean> => {
    const result = await checkServerHealth()
    setServer({
      checked: true,
      ok: result.ok,
      message: result.message,
    })
    if (result.ok) {
      const phase = await refreshAuth()
      // 只在已登录时拉档案，避免未登录时调受保护接口触发 401
      if (phase === "authed") {
        try {
          const profile = await profileApi.get()
          if (profile?.nickname) {
            setStoredNickname(profile.nickname)
            setNicknameState(profile.nickname)
          }
        } catch {
          /* 档案接口未就绪时仍用本地昵称 */
        }
      }
    }
    return result.ok
  }, [refreshAuth])

  const setupAccount = useCallback(
    async (name: string, password: string) => {
      await authApi.setup(name, password)
      await refreshAuth()
    },
    [refreshAuth],
  )

  const login = useCallback(
    async (name: string, password: string) => {
      await authApi.login(name, password)
      await refreshAuth()
    },
    [refreshAuth],
  )

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } catch {
      /* 忽略：本地照样清状态 */
    }
    setUsername(null)
    setAuthPhase("need_login")
  }, [])

  const resetServer = useCallback(() => {
    clearApiBase()
    window.location.href = "/setup"
  }, [])

  const setNickname = useCallback((name: string) => {
    setStoredNickname(name)
    setNicknameState(getStoredNickname())
    const trimmed = (name || "").trim()
    if (trimmed) {
      void profileApi.put({ nickname: trimmed }).catch(() => {})
    }
  }, [])

  const user: User = {
    id: 1,
    email: LOCAL_EMAIL,
    nickname: nickname || "学习者",
    username: username || "local",
    is_active: true,
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        serverConfigured,
        server,
        authPhase,
        username,
        checkServer,
        refreshAuth,
        setupAccount,
        login,
        logout,
        resetServer,
        setNickname,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
