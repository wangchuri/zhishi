import type { NavGroup } from "@/types"
import {
  Home,
  MessageSquare,
  NotebookPen,
  Library,
  BarChart3,
  Bell,
  Brain,
  PenLine,
  Upload,
  UserCircle,
  Settings,
  Stethoscope,
  Target,
  BookOpen,
  Trophy,
  CalendarDays,
  ScanText,
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
      { label: "题库页", to: "/quiz", icon: Brain },
      { label: "出题页", to: "/question-gen", icon: PenLine },
      { label: "上传资料", to: "/knowledge/upload", icon: Upload },
      { label: "扫描件解析", to: "/doc-parse", icon: ScanText },
    ],
  },
  {
    title: "学习",
    items: [
      { label: "伴学", to: "/companion", icon: BookOpen },
      { label: "学习分析", to: "/analytics", icon: BarChart3 },
      { label: "针对训练", to: "/training/targeted", icon: Target },
      { label: "智能提醒", to: "/reminders", icon: Bell },
      { label: "学习计划", to: "/plans", icon: CalendarDays },
      { label: "成就墙", to: "/achievements", icon: Trophy },
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