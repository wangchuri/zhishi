import { NavLink } from "react-router-dom"
import { ChevronLeft } from "lucide-react"
import { navGroups } from "@/data/nav"
import { useUI } from "@/context/UIContext"
import { useAuth } from "@/context/AuthContext"
import { cn } from "@/lib/utils"

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, setMobileMenuOpen } = useUI()
  const { user } = useAuth()
  const handleNavClick = () => setMobileMenuOpen(false)

  return (
    <aside
      className={cn(
        "bg-paper border-r border-line-light flex flex-col shrink-0 h-dvh max-h-dvh transition-all duration-200",
        sidebarCollapsed ? "w-[72px]" : "w-[248px]",
      )}
    >
      {/* 品牌名 */}
      <div className="h-16 flex items-center px-5 shrink-0">
        <div className={cn(sidebarCollapsed ? "flex justify-center w-full" : "")}>
          {!sidebarCollapsed ? (
            <div className="min-w-0">
              <div className="font-display text-display-m text-ink leading-tight">知拾</div>
              <div className="text-caption text-ink-disabled leading-tight">self-learning companion</div>
            </div>
          ) : (
            <span className="font-display text-title-s text-ink">知</span>
          )}
        </div>
      </div>

      {/* 导航 */}
      <nav className="flex-1 overflow-y-auto scroll-thin px-3 py-2 space-y-4 min-h-0">
        {navGroups.map((group, gi) => (
          <div key={gi} className="space-y-0.5">
            {group.title && !sidebarCollapsed && (
              <div className="px-3 pt-2 pb-1.5 text-caption font-medium text-ink-disabled uppercase tracking-[0.12em]">
                {group.title}
              </div>
            )}
            {group.title && sidebarCollapsed && (
              <div className="mx-3 my-2 border-t border-line-light" />
            )}
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                onClick={handleNavClick}
                className={({ isActive }) =>
                  cn(
                    "group relative flex items-center gap-3 rounded-[4px] px-3 h-10 text-body transition-all duration-150",
                    sidebarCollapsed && "justify-center px-0",
                    isActive
                      ? "bg-sea-subtle text-ink font-medium"
                      : "text-ink-soft hover:bg-sea-subtle hover:text-ink",
                  )
                }
                title={sidebarCollapsed ? item.label : undefined}
              >
                {({ isActive }) => (
                  <>
                    {isActive && !sidebarCollapsed && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-sea" />
                    )}
                    <item.icon
                      className={cn(
                        "w-[18px] h-[18px] shrink-0",
                        isActive ? "text-sea" : "text-ink-disabled group-hover:text-sea",
                      )}
                      strokeWidth={2}
                    />
                    {!sidebarCollapsed && <span className="truncate-1">{item.label}</span>}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* 底部用户区 */}
      <div className="border-t border-line-light p-3 shrink-0">
        <div className={cn("flex items-center gap-2.5 rounded-[4px] p-2", !sidebarCollapsed && "hover:bg-paper-2 cursor-pointer transition-colors")}>
          <div className="w-8 h-8 rounded-full bg-sea-subtle text-sea flex items-center justify-center text-small font-semibold shrink-0">
            {user?.nickname?.charAt(0) || "?"}
          </div>
          {!sidebarCollapsed && (
            <div className="min-w-0 flex-1">
              <div className="text-body text-ink leading-tight truncate-1">{user?.nickname || "未登录"}</div>
              <div className="text-small text-ink-disabled leading-tight">个人学习画像</div>
            </div>
          )}
        </div>
      </div>

      {/* 折叠按钮 — 桌面端可见 */}
      <button
        onClick={toggleSidebar}
        className="hidden lg:flex absolute top-7 -right-3 w-6 h-6 rounded-full bg-paper border border-line shadow-xs items-center justify-center text-ink-disabled hover:text-sea hover:border-sea/40 transition-colors"
        style={{ zIndex: 30 }}
        aria-label="折叠侧边栏"
      >
        <ChevronLeft className={cn("w-3.5 h-3.5 transition-transform duration-200", sidebarCollapsed && "rotate-180")} />
      </button>
    </aside>
  )
}
