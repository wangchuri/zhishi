import { useState, useRef, useEffect } from "react"
import { Search, PanelRight, LogOut, Menu } from "lucide-react"
import { useLocation, useNavigate } from "react-router-dom"
import { useUI } from "@/context/UIContext"
import { useAuth } from "@/context/AuthContext"
import { cn } from "@/lib/utils"

const titleMap: Record<string, string> = {
  "/": "首页",
  "/chat": "AI 对话",
  "/notes": "笔记",
  "/knowledge": "知识库管理",
  "/knowledge/upload": "上传到知识库",
  "/graph": "知识图谱",
  "/analytics": "学习分析",
  "/path": "学习路径",
  "/reminders": "智能提醒",
  "/profile": "个人学习画像",
  "/settings": "设置",
  "/settings/diagnostics": "诊断与修复",
}

export function Topbar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { rightPanelOpen, toggleRightPanel, toggleMobileMenu } = useUI()
  const { user, logout } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const title = titleMap[location.pathname] ?? "知拾"

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

  const handleLogout = () => {
    logout()
    navigate("/login")
  }

  return (
    <header className="h-16 shrink-0 border-b border-line bg-header-glass flex items-center gap-3 px-4 md:px-6">
      {/* 平板端：汉堡菜单 */}
      <button
        onClick={toggleMobileMenu}
        className="lg:hidden inline-flex items-center justify-center w-10 h-10 rounded-[4px] text-ink-soft hover:bg-paper-2 hover:text-ink transition-colors -ml-1"
        aria-label="打开导航菜单"
      >
        <Menu className="w-5 h-5" strokeWidth={2} />
      </button>

      {/* 左侧：页面标题（品牌名只在侧栏） */}
      <div className="flex items-center shrink-0 min-w-0">
        <span className="text-title-s text-ink truncate">{title}</span>
      </div>

      {/* 中间：搜索框 */}
      <div className="flex-1 max-w-[560px] mx-auto">
        <div className="relative group">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-ink-disabled group-focus-within:text-sea transition-colors" strokeWidth={2} />
          <input
            type="text"
            placeholder="搜索笔记、文档、标签或向 Tina 提问..."
            className="w-full h-10 pl-11 pr-16 rounded-[4px] bg-paper-2 border border-line text-body text-ink placeholder:text-ink-disabled focus:outline-none focus:border-sea focus:bg-paper focus:ring-1 focus:ring-sea-subtle transition-all"
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden sm:flex items-center gap-0.5 px-1.5 h-5 rounded-[4px] border border-line bg-paper text-small text-ink-disabled">
            ⌘ K
          </kbd>
        </div>
      </div>

      {/* 右侧：操作 */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={toggleRightPanel}
          className={cn(
            "inline-flex items-center justify-center w-9 h-9 rounded-[4px] transition-colors",
            rightPanelOpen ? "text-sea bg-sea-subtle" : "text-ink-soft hover:bg-sea-subtle hover:text-sea",
          )}
          aria-label="切换右侧面板"
        >
          <PanelRight className="w-[18px] h-[18px]" strokeWidth={2} />
        </button>

        <div className="w-px h-6 bg-line mx-1" />

        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="w-9 h-9 rounded-full bg-sea-subtle text-sea flex items-center justify-center text-small font-semibold cursor-pointer hover:ring-2 hover:ring-sea-subtle transition-all"
          >
            {user?.nickname?.charAt(0) || "?"}
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-11 w-48 bg-paper border border-line rounded-[4px] shadow-sm py-1 z-50">
              <div className="px-3 py-2 border-b border-line-light">
                <div className="text-small font-medium text-ink">{user?.nickname || "用户"}</div>
                <div className="text-caption text-ink-disabled truncate">{user?.email || ""}</div>
              </div>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-small text-ink-soft hover:text-danger hover:bg-danger-soft transition-colors"
              >
                <LogOut className="w-4 h-4" strokeWidth={2} />
                退出登录
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
