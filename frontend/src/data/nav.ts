import type { NavGroup } from "@/types"
import {
  Home,
  MessageSquare,
  NotebookPen,
  Library,
  Network,
  BarChart3,
  Route,
  Bell,
  Upload,
  UserCircle,
  Settings,
  Stethoscope,
} from "lucide-react"

export const navGroups: NavGroup[] = [
  {
    title: "",
    items: [{ label: "首页", to: "/", icon: Home }],
  },
  {
    title: "主要",
    items: [
      { label: "AI 对话", to: "/chat", icon: MessageSquare },
      { label: "笔记", to: "/notes", icon: NotebookPen },
      { label: "知识库", to: "/knowledge", icon: Library },
      { label: "上传资料", to: "/knowledge/upload", icon: Upload },
    ],
  },
  {
    title: "学习",
    items: [
      { label: "知识图谱", to: "/graph", icon: Network },
      { label: "学习分析", to: "/analytics", icon: BarChart3 },
      { label: "学习路径", to: "/path", icon: Route },
      { label: "智能提醒", to: "/reminders", icon: Bell },
    ],
  },
  {
    title: "个人",
    items: [
      { label: "个人学习画像", to: "/profile", icon: UserCircle },
      { label: "设置", to: "/settings", icon: Settings },
      { label: "诊断与修复", to: "/settings/diagnostics", icon: Stethoscope },
    ],
  },
]

export const userInfo = {
  name: "啊噗",
  role: "学生",
  avatar: "啊",
  streak: 5,
}
