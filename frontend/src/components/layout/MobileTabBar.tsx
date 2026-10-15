import { NavLink } from "react-router-dom"
import { Home, Library, MessageSquare, NotebookPen } from "lucide-react"
import { useTinaCrisis } from "@/context/TinaCrisisContext"
import { cn } from "@/lib/utils"

/**
 * 移动端底部主导航 · 极简四页：首页 / Tina / 资料 / 笔记。
 * 次级入口（上传、任务、进度、扫描件解析、设置…）留在「更多」抽屉里，不放主路径。
 */
const TABS = [
  { to: "/", label: "首页", icon: Home, end: true },
  { to: "/chat", label: "Tina", icon: MessageSquare, end: false },
  { to: "/quiz", label: "资料", icon: Library, end: false },
  { to: "/notes", label: "笔记", icon: NotebookPen, end: false },
]

export function MobileTabBar() {
  const { active, escaping } = useTinaCrisis()
  // 危机彩蛋进行中：与侧栏一致，除 Tina 外都锁住
  const locked = active || escaping

  return (
    <nav
      data-no-tip
      className="lg:hidden shrink-0 border-t border-line bg-paper/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)]"
    >
      <div className="flex">
        {TABS.map((tab) => {
          const blocked = locked && tab.to !== "/chat"
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              onClick={(e) => {
                if (blocked) e.preventDefault()
              }}
              className={({ isActive }) =>
                cn(
                  "flex-1 flex flex-col items-center justify-center gap-1 pt-2 pb-1.5 transition-colors",
                  blocked && "opacity-40",
                  isActive ? "text-sea" : "text-ink-disabled",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <tab.icon className="w-[22px] h-[22px]" strokeWidth={isActive ? 2.4 : 2} />
                  <span className={cn("text-[11px] leading-none", isActive && "font-medium")}>
                    {tab.label}
                  </span>
                </>
              )}
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
