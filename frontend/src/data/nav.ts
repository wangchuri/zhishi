import type { NavGroup } from "@/types"
import {
  Home,
  MessageSquare,
  NotebookPen,
  Library,
  BarChart3,
  Settings,
  ScanText,
  ListChecks,
} from "lucide-react"

export const navGroups: NavGroup[] = [
  {
    title: "",
    items: [{ label: "首页", to: "/", icon: Home }],
  },
  {
    title: "主要",
    items: [
      { label: "Tina", to: "/chat", icon: MessageSquare },
      { label: "笔记", to: "/notes", icon: NotebookPen },
      { label: "资料", to: "/quiz", icon: Library },
      { label: "扫描件解析", to: "/doc-parse", icon: ScanText },
    ],
  },
  {
    title: "学习",
    items: [
      { label: "任务", to: "/tasks", icon: ListChecks },
      { label: "进度", to: "/analytics", icon: BarChart3 },
    ],
  },
  {
    title: "个人",
    items: [{ label: "设置", to: "/settings", icon: Settings }],
  },
]

export const TINA_PATH = "/chat"

/** 危机彩蛋：侧栏里除 Tina 外、尚未被藏起的入口名。 */
export function remainingCrisisPages(deleted: Set<string>): string[] {
  return navGroups
    .flatMap((g) => g.items)
    .filter((item) => item.to !== TINA_PATH && !deleted.has(item.to))
    .map((item) => item.label)
}

export const userInfo = {
  name: "啊噗",
  role: "学生",
  avatar: "啊",
  streak: 5,
}
