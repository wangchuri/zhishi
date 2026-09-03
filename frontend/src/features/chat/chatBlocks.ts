import type { ChatMessage } from "@/types"
import type { ChatQuestionWidget } from "@/features/chat/ChatQuestionCard"
import type { ChatTipPayload } from "@/features/chat/ChatTipCard"
import type { ChatPlotPayload } from "@/features/chat/ChatFunctionPlot"
import type { ChatHtmlCanvas } from "@/features/chat/ChatCanvasSidebar"

export type ChatOnboardingItem = NonNullable<ChatMessage["payload"]>["onboarding"] extends (infer T)[] | undefined
  ? T
  : never

export type ChatPayloadBlock =
  | { type: "text"; content: string }
  | { type: "tip"; tip: ChatTipPayload }
  | { type: "widget"; widget: ChatQuestionWidget }
  | { type: "onboarding"; item: ChatOnboardingItem }
  | { type: "plot"; plot: ChatPlotPayload }
  | { type: "canvas"; canvas: ChatHtmlCanvas }

export function appendTextBlock(blocks: ChatPayloadBlock[] | undefined, chunk: string): ChatPayloadBlock[] {
  if (!chunk) return blocks || []
  const next = [...(blocks || [])]
  const last = next[next.length - 1]
  if (last?.type === "text") {
    next[next.length - 1] = { type: "text", content: last.content + chunk }
  } else {
    next.push({ type: "text", content: chunk })
  }
  return next
}

export function appendTipBlock(blocks: ChatPayloadBlock[] | undefined, tip: ChatTipPayload): ChatPayloadBlock[] {
  const next = [...(blocks || [])]
  if (next.some((b) => b.type === "tip" && b.tip.id === tip.id)) return next
  next.push({ type: "tip", tip })
  return next
}

export function appendPlotBlock(blocks: ChatPayloadBlock[] | undefined, plot: ChatPlotPayload): ChatPayloadBlock[] {
  const next = [...(blocks || [])]
  if (next.some((b) => b.type === "plot" && b.plot.id === plot.id)) return next
  next.push({ type: "plot", plot })
  return next
}

export function appendCanvasBlock(
  blocks: ChatPayloadBlock[] | undefined,
  canvas: ChatHtmlCanvas,
): ChatPayloadBlock[] {
  const next = [...(blocks || [])]
  if (next.some((b) => b.type === "canvas" && b.canvas.id === canvas.id)) return next
  next.push({ type: "canvas", canvas })
  return next
}

export function appendWidgetBlock(
  blocks: ChatPayloadBlock[] | undefined,
  widget: ChatQuestionWidget,
): ChatPayloadBlock[] {
  const next = [...(blocks || [])]
  const qid = widget.question.question_id
  if (next.some((b) => b.type === "widget" && b.widget.question.question_id === qid)) return next
  next.push({ type: "widget", widget })
  return next
}

export function appendOnboardingBlock(
  blocks: ChatPayloadBlock[] | undefined,
  item: ChatOnboardingItem,
): ChatPayloadBlock[] {
  const next = [...(blocks || [])]
  const dup =
    item.type === "goal_card"
      ? next.some((b) => b.type === "onboarding" && b.item.type === "goal_card" && b.item.goal === item.goal)
      : next.some((b) => b.type === "onboarding" && b.item.type === item.type)
  if (dup) return next
  next.push({ type: "onboarding", item })
  return next
}

/** 历史消息无 blocks 时，按旧逻辑拼成「先全文、再卡片」顺序。 */
export function resolveChatBlocks(message: ChatMessage): ChatPayloadBlock[] {
  const stored = message.payload?.blocks
  if (stored?.length) return stored as ChatPayloadBlock[]
  const out: ChatPayloadBlock[] = []
  if (message.content) out.push({ type: "text", content: message.content })
  for (const tip of message.payload?.tips || []) out.push({ type: "tip", tip })
  for (const plot of message.payload?.plots || []) out.push({ type: "plot", plot })
  for (const canvas of message.payload?.canvases || []) out.push({ type: "canvas", canvas })
  for (const widget of message.payload?.widgets || []) out.push({ type: "widget", widget })
  for (const item of message.payload?.onboarding || []) out.push({ type: "onboarding", item })
  return out
}

export function updateWidgetInPayload(
  payload: ChatMessage["payload"],
  questionId: string,
  next: ChatQuestionWidget,
): ChatMessage["payload"] {
  const base = payload || {}
  const widgets = (base.widgets || []).map((w) =>
    w.question.question_id === questionId ? next : w,
  )
  const blocks = (base.blocks as ChatPayloadBlock[] | undefined)?.map((b) =>
    b.type === "widget" && b.widget.question.question_id === questionId ? { ...b, widget: next } : b,
  )
  return { ...base, widgets, blocks }
}
