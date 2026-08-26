import { useState, useRef, useEffect } from "react"
import { PanelRight, Server, Menu, Wifi, WifiOff, Maximize, Minimize2 } from "lucide-react"
import { useLocation, useNavigate } from "react-router-dom"
import { useUI } from "@/context/UIContext"
import { useAuth } from "@/context/AuthContext"
import { useTinaCrisis } from "@/context/TinaCrisisContext"
import { useFullscreen } from "@/hooks/useFullscreen"
import { cn } from "@/lib/utils"

const titleMap: Record<string, string> = {
  "/": "首页",
  "/chat": "Tina",
  "/notes": "笔记",
  "/knowledge/upload": "上传资料",
  "/quiz": "资料",
  "/quiz/ongoing": "继续刷题",
  "/graph": "知识图谱",
  "/tasks": "任务",
  "/analytics": "进度",
  "/path": "学习路径",
  "/profile": "设置",
  "/settings": "设置",
}

function resolveTitle(pathname: string): string {
  if (titleMap[pathname]) return titleMap[pathname]
  if (pathname.startsWith("/notes/")) return "笔记"
  if (pathname.startsWith("/companion/doc/")) return "阅读"
  return "知拾"
}

export function Topbar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { rightPanelOpen, toggleRightPanel, toggleMobileMenu } = useUI()
  const { user, server } = useAuth()
  const { active: crisisLocked } = useTinaCrisis()
  const { isFs, toggle } = useFullscreen()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const title = resolveTitle(location.pathname)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [menuOpen])

  return (
    <header
      data-no-tip
      className="relative z-[55] h-16 shrink-0 border-b border-line bg-header-glass flex items-center gap-3 px-4 md:px-6"
      style={{ height: "calc(4rem + env(safe-area-inset-top))", paddingTop: "env(safe-area-inset-top)" }}
    >
      {/* 平板端：汉堡菜单 */}
      <button
        onClick={toggleMobileMenu}
        className="lg:hidden inline-flex items-center justify-center w-10 h-10 rounded-[4px] text-ink-soft hover:bg-paper-2 hover:text-ink transition-colors -ml-1"
        aria-label="打开导航菜单"
      >
        <Menu className="w-5 h-5" strokeWidth={2} />
      </button>

      <div className="flex items-center shrink-0 min-w-0">
        <span className="text-title-s text-ink truncate">{title}</span>
      </div>

      <div className="flex-1" />

      {/* 右侧：操作 */}
      <div className="flex items-center gap-2 shrink-0">
        {/* 全屏切换 */}
        <button
          onClick={toggle}
          className={cn(
            "inline-flex items-center justify-center w-10 h-10 rounded-[4px] transition-colors",
            isFs ? "text-sea bg-sea-subtle" : "text-ink-soft hover:bg-sea-subtle hover:text-sea",
          )}
          aria-label={isFs ? "退出全屏" : "进入全屏"}
          title={isFs ? "退出全屏" : "进入全屏"}
        >
          {isFs ? (
            <Minimize2 className="w-[18px] h-[18px]" strokeWidth={2} />
          ) : (
            <Maximize className="w-[18px] h-[18px]" strokeWidth={2} />
          )}
        </button>

        <button
          onClick={toggleRightPanel}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-full border transition-colors",
            rightPanelOpen
              ? "text-paper bg-sea border-sea"
              : "text-ink-soft border-line bg-paper hover:text-sea hover:border-sea/40 hover:bg-sea-subtle",
          )}
          aria-label="今日状态"
          aria-expanded={rightPanelOpen}
          title={rightPanelOpen ? "关闭今日状态" : "打开今日状态"}
        >
          <PanelRight className="w-4 h-4" strokeWidth={2} />
          <span className="hidden sm:inline text-caption font-medium">今日状态</span>
        </button>

        <div className="w-px h-6 bg-line mx-1" />

        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-1.5 h-9 px-2 rounded-full bg-sea-subtle text-sea text-small font-semibold cursor-pointer hover:ring-2 hover:ring-sea-subtle transition-all"
            title="服务器连接状态"
          >
            {server.ok ? <Wifi className="w-4 h-4" strokeWidth={2} /> : <WifiOff className="w-4 h-4" strokeWidth={2} />}
            <span className="hidden sm:block">{user?.nickname?.charAt(0) || "?"}</span>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-11 w-52 bg-paper border border-line rounded-[4px] shadow-sm py-1 z-50">
              <div className="px-3 py-2 border-b border-line-light">
                <div className="text-small font-medium text-ink">{user?.nickname || "学习者"}</div>
                <div className="text-caption text-ink-disabled truncate">{user?.email || ""}</div>
              </div>
              <div className="px-3 py-2 border-b border-line-light">
                <div className="flex items-center gap-1.5 text-caption text-ink-soft">
                  {server.ok ? (
                    <><Wifi className="w-3.5 h-3.5 text-success" strokeWidth={2} />服务器已连接</>
                  ) : (
                    <><WifiOff className="w-3.5 h-3.5 text-danger" strokeWidth={2} />未连接 / 检测中</>
                  )}
                </div>
                {server.message && <div className="text-caption text-ink-disabled mt-0.5">{server.message}</div>}
              </div>
              <button
                onClick={() => {
                  if (crisisLocked) return
                  setMenuOpen(false)
                  navigate("/settings")
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-small text-ink-soft hover:text-sea hover:bg-sea-subtle transition-colors"
              >
                <Server className="w-4 h-4" strokeWidth={2} />
                服务器设置
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
