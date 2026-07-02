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
  segment_status?: string
  question_gen_status?: string
  questionCount?: number
  zone?: string
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

/** 引用片段（聊天 / 刷题 / 辅导） */
export interface Citation {
  doc_id: string
  segment_id?: string | null
  title?: string | null
  char_start?: number | null
  char_end?: number | null
  snippet?: string | null
}

/** 知识库分区 */
export interface KbCollection {
  id: string
  name: string
  zone: "study" | "life"
  description?: string | null
  dataset_id?: string | null
  is_default?: boolean
  created_at?: string
  updated_at?: string
}

/** 文档分段 */
export interface DocumentSegment {
  id: string
  document_id: string
  order_index: number
  title?: string | null
  content: string
  char_start: number
  char_end: number
  created_at?: string
}

/** 题目选项 */
export interface QuestionOption {
  key: string
  text: string
}

/** 题目 */
export interface Question {
  id: string
  stem: string
  question_type: string
  options?: QuestionOption[]
  answer?: string
  explanation?: string | null
  tags?: string[]
  source_type?: string
  document_id?: string | null
  collection_id?: string | null
  created_at?: string
}

/** 刷题会话中的题目（不含答案） */
export interface QuizSessionQuestion {
  question_id: string
  order_index: number
  stem: string
  question_type: string
  options?: QuestionOption[]
}

/** 刷题会话 */
export interface QuizSession {
  id: string
  title?: string | null
  status: "active" | "completed" | string
  document_id?: string | null
  collection_id?: string | null
  total_questions: number
  answered_count: number
  started_at?: string | null
  finished_at?: string | null
  questions: QuizSessionQuestion[]
}

/** 单题作答结果 */
export interface QuizAnswerResult {
  question_id: string
  status: "correct" | "wrong" | "unknown" | string
  correct_answer?: string | null
  explanation?: string | null
  citation?: Citation | null
  answered_count: number
  total_questions: number
  session_status: string
}

/** 错题回顾项 */
export interface QuizReviewItem {
  question_id: string
  stem: string
  user_answer?: string | null
  status: "wrong" | "unknown" | string
  correct_answer: string
  explanation?: string | null
  citation?: Citation | null
}

/** 刷题结果汇总 */
export interface QuizResults {
  session_id: string
  status: string
  total_questions: number
  correct_count: number
  wrong_count: number
  unknown_count: number
  items: QuizReviewItem[]
}

/** 辅导消息 */
export interface TutorMessage {
  role: "user" | "assistant" | string
  content: string
  created_at?: string
}

/** 辅导会话 */
export interface TutorSession {
  id: string
  question_id: string
  document_id?: string | null
  segment_id?: string | null
  quiz_answer_id?: string | null
  status: string
  question_stem?: string | null
  segment_context?: {
    segment_id?: string
    title?: string
    snippet?: string
  } | null
  messages: TutorMessage[]
  created_at?: string
  updated_at?: string
}

/** 对话消息 */
export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  time: string
  refs?: string[]
  citations?: Citation[]
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
