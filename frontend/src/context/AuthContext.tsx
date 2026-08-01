import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react"
import {
  isServerConfigured,
  checkServerHealth,
  clearApiBase,
  getStoredNickname,
  setStoredNickname,
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

interface AuthState {
  user: User
  serverConfigured: boolean
  server: ServerState
  /** 每次运行/进入应用时调用：检测当前服务器是否正常运行 */
  checkServer: () => Promise<boolean>
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

  const checkServer = useCallback(async (): Promise<boolean> => {
    const result = await checkServerHealth()
    setServer({
      checked: true,
      ok: result.ok,
      message: result.message,
    })
    return result.ok
  }, [])

  const resetServer = useCallback(() => {
    clearApiBase()
    window.location.href = "/setup"
  }, [])

  const setNickname = useCallback((name: string) => {
    setStoredNickname(name)
    setNicknameState(getStoredNickname())
  }, [])

  const user: User = {
    id: 1,
    email: LOCAL_EMAIL,
    nickname: nickname || "学习者",
    username: "local",
    is_active: true,
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        serverConfigured,
        server,
        checkServer,
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