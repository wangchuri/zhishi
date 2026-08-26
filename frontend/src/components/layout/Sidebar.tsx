import { useState, type MouseEvent } from "react"
import { NavLink, useNavigate } from "react-router-dom"
import { ChevronLeft, Trash2 } from "lucide-react"
import { navGroups, remainingCrisisPages } from "@/data/nav"
import { useUI } from "@/context/UIContext"
import { useAuth } from "@/context/AuthContext"
import { useTinaCrisis } from "@/context/TinaCrisisContext"
import { cn } from "@/lib/utils"
import { TinaFireworks } from "./TinaFireworks"
import { AppLogo } from "./AppLogo"
import type { NavItem } from "@/types"

function SidebarNavItem({
  item,
  collapsed,
  onNavigate,
  showTrash,
  onDelete,
}: {
  item: NavItem
  collapsed: boolean
  onNavigate: () => void
  showTrash: boolean
  onDelete: () => void
}) {
  const { escaping, active } = useTinaCrisis()
  const isTina = item.to === "/chat"
  const locked = (active || escaping) && !isTina
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const [hovering, setHovering] = useState(false)
  const [poke, setPoke] = useState(0)

  const trackPointer = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!isTina) return
    setPointer({ x: e.clientX, y: e.clientY })
  }

  return (
    <div className={cn("flex items-center gap-0.5", collapsed && "flex-col")}>
      <NavLink
        to={item.to}
        end={item.to === "/"}
        onClick={(e) => {
          if (locked || escaping) {
            e.preventDefault()
            return
          }
          onNavigate()
        }}
        onMouseEnter={(e) => {
          if (!isTina) return
          trackPointer(e)
          setHovering(true)
          setPoke((n) => n + 1)
        }}
        onMouseMove={trackPointer}
        onMouseLeave={() => {
          if (!isTina) return
          setHovering(false)
        }}
        className={({ isActive }) =>
          cn(
            "group relative flex items-center gap-3 rounded-[4px] px-3 h-10 text-body transition-all duration-150 min-w-0",
            collapsed ? "justify-center px-0 w-full" : "flex-1",
            locked && "cursor-not-allowed",
            isTina && isActive
              ? "bg-danger-soft text-danger font-medium"
              : isActive
                ? "bg-sea-subtle text-ink font-medium"
                : "text-ink-soft hover:bg-sea-subtle hover:text-ink",
          )
        }
        title={collapsed ? item.label : undefined}
      >
        {({ isActive }) => (
          <>
            {isActive && !collapsed && (
              <span
                className={cn(
                  "absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5",
                  isTina ? "bg-danger" : "bg-sea",
                )}
              />
            )}
            <item.icon
              className={cn(
                "w-[18px] h-[18px] shrink-0",
                isTina && isActive
                  ? "text-danger"
                  : isActive
                    ? "text-sea"
                    : "text-ink-disabled group-hover:text-sea",
              )}
              strokeWidth={2}
            />
            {!collapsed && (
              <span className={cn("truncate-1", isTina && isActive && "text-danger")}>
                {item.label}
              </span>
            )}
          </>
        )}
      </NavLink>
      {showTrash && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onDelete()
          }}
          className={cn(
            "shrink-0 rounded-[4px] flex items-center justify-center text-danger hover:bg-danger-soft transition-colors",
            collapsed ? "w-8 h-6" : "w-8 h-10",
          )}
          title={`删除${item.label}`}
          aria-label={`删除${item.label}`}
        >
          <Trash2 className="w-3.5 h-3.5" strokeWidth={2} />
        </button>
      )}
      {isTina && <TinaFireworks pointer={pointer} playing={hovering} poke={poke} />}
    </div>
  )
}

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, setMobileMenuOpen } = useUI()
  const { user } = useAuth()
  const navigate = useNavigate()
  const { active: crisis, deleted, hideControl, startEscape } = useTinaCrisis()
  const handleNavClick = () => setMobileMenuOpen(false)

  const hideItem = (item: NavItem) => {
    const next = new Set(deleted)
    next.add(item.to)
    hideControl(item.to)
    handleNavClick()
    if (remainingCrisisPages(next).length === 0) {
      startEscape()
      navigate("/chat", { replace: true })
      return
    }
    navigate(`/chat?gone=${encodeURIComponent(item.label)}`)
  }

  return (
    <aside
      data-no-tip
      className={cn(
        "bg-paper border-r border-line-light flex flex-col shrink-0 h-dvh max-h-dvh transition-all duration-200",
        sidebarCollapsed ? "w-[72px]" : "w-[248px]",
      )}
    >
      {/* 品牌名 */}
      <div className="h-16 flex items-center px-5 shrink-0">
        <div className={cn("flex items-center gap-2.5 min-w-0", sidebarCollapsed && "justify-center w-full")}>
          <AppLogo size="sm" />
          {!sidebarCollapsed ? (
            <div className="min-w-0">
              <div className="font-display text-display-m text-ink leading-tight">知拾</div>
              <div className="text-caption text-ink-disabled leading-tight">self-learning companion</div>
            </div>
          ) : null}
        </div>
      </div>

      {/* 导航 */}
      <nav className="flex-1 overflow-y-auto scroll-thin px-3 py-2 space-y-4 min-h-0">
        {navGroups.map((group, gi) => {
          const items = group.items.filter((item) => !deleted.has(item.to))
          if (items.length === 0) return null
          return (
          <div key={gi} className="space-y-0.5">
            {group.title && !sidebarCollapsed && (
              <div className="px-3 pt-2 pb-1.5 text-caption font-medium text-ink-disabled uppercase tracking-[0.12em]">
                {group.title}
              </div>
            )}
            {group.title && sidebarCollapsed && (
              <div className="mx-3 my-2 border-t border-line-light" />
            )}
            {items.map((item) => (
              <SidebarNavItem
                key={item.to}
                item={item}
                collapsed={sidebarCollapsed}
                onNavigate={handleNavClick}
                showTrash={crisis && item.to !== "/chat"}
                onDelete={() => hideItem(item)}
              />
            ))}
          </div>
          )
        })}
      </nav>

      {/* 底部用户区 */}
      <div className="border-t border-line-light p-3 shrink-0">
        <div
          className={cn("flex items-center gap-2.5 rounded-[4px] p-2", !sidebarCollapsed && "hover:bg-paper-2 cursor-pointer transition-colors")}
          onClick={() => navigate("/settings")}
          role="button"
        >
          <div className="w-8 h-8 rounded-full bg-sea-subtle text-sea flex items-center justify-center text-small font-semibold shrink-0">
            {user?.nickname?.charAt(0) || "?"}
          </div>
          {!sidebarCollapsed && (
            <div className="min-w-0 flex-1">
              <div className="text-body text-ink leading-tight truncate-1">{user?.nickname || "未登录"}</div>
              <div className="text-small text-ink-disabled leading-tight">设置</div>
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
