// 知拾 Web 端 · 全局类型定义

import type { LucideIcon } from "lucide-react"

/** 导航项 */
export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
  badge?: string | number
}

/** 导航分组 */
export interface NavGroup {
  title: string
  items: NavItem[]
}

/** 笔记 */
export interface Note {
  id: string
  title: string
  excerpt: string
  tags: string[]
  updatedAt: string
  wordCount: number
  source: "manual" | "doc" | "ai"
  hasAISummary: boolean
  organized: boolean
  category?: string
}

/** 知识库文档 */
export interface KnowledgeDoc {
  id: string
  name: string
  type: "pdf" | "txt" | "md" | "docx" | "image" | "ocr"
  tags: string[]
  status: "indexed" | "processing" | "failed" | "pending"
  wordCount: number
  updatedAt: string
}

/** 学习技能掌握度 */
export interface SkillMastery {
  name: string
  mastery: number // 0-100
  status: "mastered" | "practicing" | "pending"
}

/** 学习路径任务 */
export interface PathTask {
  id: string
  order: number
  name: string
  priority: number
  estimatedMinutes: number
  readiness: "high" | "medium" | "low"
  currentMastery: number
  learningReadiness: number
  prerequisites: string[]
  reason: string
  suggestion: string[]
}

/** 智能提醒 */
export interface Reminder {
  id: string
  title: string
  type: "review" | "task" | "doc" | "longterm"
  time: string
  done: boolean
  repeat?: boolean
  related?: string
}

/** 图谱节点 */
export interface GraphNode {
  id: string
  label: string
  type: "tag" | "doc" | "knowledge" | "goal"
  x: number
  y: number
  size: number
  related: string[]
}

/** 图谱连线 */
export interface GraphEdge {
  from: string
  to: string
}

/** 对话消息 */
export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  time: string
  refs?: string[]
}

/** 页面布局配置 */
export interface PageLayout {
  /** 主内容区最大宽度，px。null 表示全宽 */
  maxWidth?: number | null
  /** 是否显示右侧面板 */
  showRightPanel?: boolean
  /** 右侧面板标题 */
  rightPanelTitle?: string
}
