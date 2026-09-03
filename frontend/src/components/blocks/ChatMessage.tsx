import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import type { ChatMessage as ChatMessageType, Citation } from "@/types"
import { CitationCard } from "@/components/blocks/CitationCard"
import { ChatQuestionCard, type ChatQuestionWidget } from "@/features/chat/ChatQuestionCard"
import { ChatTipCard } from "@/features/chat/ChatTipCard"
import { ChatPlotCard } from "@/features/chat/ChatPlotCard"
import { ChatHtmlCard } from "@/features/chat/ChatHtmlCard"
import type { ChatPlotPayload } from "@/features/chat/ChatFunctionPlot"
import type { ChatHtmlCanvas } from "@/features/chat/ChatCanvasSidebar"
import { resolveChatBlocks, type ChatPayloadBlock } from "@/features/chat/chatBlocks"
import {
  OnboardingDocsCard,
  OnboardingDoneCard,
  OnboardingGoalCard,
} from "@/features/onboarding/OnboardingCards"
import { MarkdownWithMath, markdownProseDangerClass } from "@/components/blocks/MarkdownWithMath"
import { ThinkingLabel } from "@/components/blocks/ThinkingLabel"
import { hasTinaMoodMarkup, parseTinaBursts } from "@/features/chat/tinaBursts"
import { cn } from "@/lib/utils"

interface ChatMessageProps {
  message: ChatMessageType
  className?: string
  onCitationClick?: (citation: Citation) => void
  onWidgetResolved?: (questionId: string, next: ChatQuestionWidget, followUp: string) => void
  onOnboardingAction?: (text: string) => void
  onPlotOpen?: (plot: ChatPlotPayload) => void
  onCanvasOpen?: (canvas: ChatHtmlCanvas) => void
  widgetsDisabled?: boolean
  /** 正在流式输出思考内容时才跳动 Thinking 动画 */
  thinkingActive?: boolean
  /** 当前这条正在流式输出，显示打字光标 */
  streaming?: boolean
}

function ReasoningBlock({
  content,
  defaultOpen = false,
  crimson = false,
  active = false,
}: {
  content: string
  defaultOpen?: boolean
  crimson?: boolean
  active?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-1 text-caption transition-colors",
          crimson ? "text-danger/70 hover:text-danger" : "text-ink-tertiary hover:text-ink-secondary",
        )}
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <ThinkingLabel active={active} />
      </button>
      {open && (
        <div
          className={cn(
            "mt-1 p-2 rounded border text-small leading-relaxed whitespace-pre-wrap",
            crimson
              ? "bg-danger-soft border-danger/20 text-danger"
              : "bg-ink-tertiary/5 border-line-soft text-ink-soft",
          )}
        >
          {content}
        </div>
      )}
    </div>
  )
}

function TinaBurstStack({
  content,
  crimson,
  streaming = false,
}: {
  content: string
  crimson?: boolean
  streaming?: boolean
}) {
  const bursts = parseTinaBursts(content)
  return (
    <div className="space-y-2.5">
      {bursts.map((b, i) => {
        const last = streaming && i === bursts.length - 1
        return (
          <div
            key={i}
            className={cn(
              "rounded-[12px] border px-3.5 py-2.5",
              crimson ? "border-danger/25 bg-danger-soft/40" : "border-line-light bg-paper-2/80",
            )}
          >
            {b.text ? (
              last ? (
                <StreamingInk text={b.text} crimson={Boolean(crimson)} />
              ) : (
                <MarkdownWithMath proseClass={crimson ? markdownProseDangerClass : undefined}>
                  {b.text}
                </MarkdownWithMath>
              )
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function graphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    return [...new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(text)].map((p) => p.segment)
  }
  return Array.from(text)
}

const INK_TAIL = 18

function StreamingInk({ text, crimson }: { text: string; crimson: boolean }) {
  const chars = graphemes(text)
  const split = Math.max(0, chars.length - INK_TAIL)
  const head = chars.slice(0, split).join("")
  const tail = chars.slice(split)
  return (
    <div
      className={cn(
        "whitespace-pre-wrap break-words leading-relaxed",
        crimson ? "text-danger" : "text-ink",
      )}
    >
      {head}
      {tail.map((ch, i) => (
        <span key={split + i} className="stream-ink-char">
          {ch}
        </span>
      ))}
    </div>
  )
}

function renderTextBlock(content: string, crimson: boolean, key: string | number, streaming = false) {
  if (!content.trim()) return null
  if (streaming && !hasTinaMoodMarkup(content)) {
    return <StreamingInk key={key} text={content} crimson={crimson} />
  }
  if (hasTinaMoodMarkup(content)) {
    return <TinaBurstStack key={key} content={content} crimson={crimson} streaming={streaming} />
  }
  return (
    <MarkdownWithMath key={key} proseClass={crimson ? markdownProseDangerClass : undefined}>
      {content}
    </MarkdownWithMath>
  )
}

function renderChatBlock(
  block: ChatPayloadBlock,
  key: string | number,
  message: ChatMessageType,
  crimson: boolean,
  widgetsDisabled: boolean | undefined,
  onWidgetResolved: ChatMessageProps["onWidgetResolved"],
  onOnboardingAction: ChatMessageProps["onOnboardingAction"],
  onPlotOpen: ChatMessageProps["onPlotOpen"],
  onCanvasOpen: ChatMessageProps["onCanvasOpen"],
  streamingText = false,
) {
  if (block.type === "text") {
    return renderTextBlock(block.content, crimson, key, streamingText)
  }
  if (block.type === "tip") {
    return <ChatTipCard key={key} tip={block.tip} />
  }
  if (block.type === "plot") {
    return <ChatPlotCard key={key} plot={block.plot} onOpen={onPlotOpen} />
  }
  if (block.type === "canvas") {
    return <ChatHtmlCard key={key} canvas={block.canvas} onOpen={onCanvasOpen} />
  }
  if (block.type === "widget") {
    return (
      <ChatQuestionCard
        key={key}
        widget={block.widget}
        chatMessageId={message.id}
        disabled={widgetsDisabled}
        onResolved={(next, followUp) =>
          onWidgetResolved?.(next.question.question_id, next, followUp)
        }
      />
    )
  }
  if (block.type === "onboarding") {
    const item = block.item
    if (item.type === "goal_card" && item.goal) {
      return (
        <OnboardingGoalCard
          key={key}
          goal={item.goal}
          locked={widgetsDisabled}
          busy={widgetsDisabled}
          onConfirm={() => onOnboardingAction?.("我确认这个目标，就是这个。")}
          onChange={() => onOnboardingAction?.("还想改一下")}
        />
      )
    }
    if (item.type === "docs_card") {
      return (
        <OnboardingDocsCard
          key={key}
          locked={widgetsDisabled}
          busy={widgetsDisabled}
          onSkip={() => onOnboardingAction?.("先跳过资料。")}
        />
      )
    }
    if (item.type === "done") {
      return <OnboardingDoneCard key={key} />
    }
  }
  return null
}

export function ChatMessage({
  message,
  className,
  onCitationClick,
  onWidgetResolved,
  onOnboardingAction,
  widgetsDisabled,
  thinkingActive,
  streaming,
  onPlotOpen,
  onCanvasOpen,
}: ChatMessageProps) {
  const isUser = message.role === "user"
  const crimson = Boolean(message.crimson)
  const glitch = Boolean(message.glitch)
  const blocks = !isUser && !glitch ? resolveChatBlocks(message) : null

  if (isUser) {
    return (
      <div className={cn("animate-msg-in", className)}>
        <div className="bg-sea text-paper rounded-[4px] px-4 py-2.5 text-body leading-relaxed">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className={cn("animate-msg-in", className)}>
      <div className={cn("text-body leading-relaxed space-y-2", crimson ? "text-danger" : "text-ink")}>
        {message.reasoning_content && (
          <ReasoningBlock
            content={message.reasoning_content}
            defaultOpen={glitch}
            crimson={crimson}
            active={Boolean(thinkingActive)}
          />
        )}
        {glitch ? (
          <div className="text-danger whitespace-pre-wrap break-all leading-relaxed">
            {message.content}
          </div>
        ) : blocks ? (
          blocks.map((block, i) =>
            renderChatBlock(
              block,
              i,
              message,
              crimson,
              widgetsDisabled,
              onWidgetResolved,
              onOnboardingAction,
              onPlotOpen,
              onCanvasOpen,
              Boolean(
                streaming &&
                  block.type === "text" &&
                  i === blocks.reduce((acc, b, idx) => (b.type === "text" ? idx : acc), -1),
              ),
            ),
          )
        ) : null}
        {streaming && !glitch ? (
          <span className="stream-caret" aria-hidden />
        ) : null}
        {message.citations && message.citations.length > 0 && (
          <div className="mt-4 pt-3 border-t border-line-soft space-y-2">
            <div className="text-small text-ink-tertiary">引用来源：</div>
            {message.citations.map((c, i) => (
              <CitationCard
                key={i}
                citation={c}
                variant="inline"
                onSelect={onCitationClick}
              />
            ))}
          </div>
        )}
        {message.refs && message.refs.length > 0 && (
          <div className="mt-4 pt-3 border-t border-line-soft space-y-1">
            <div className="text-small text-ink-tertiary">引用文档：</div>
            {message.refs.map((ref, i) => (
              <div key={i} className="text-small text-ink-secondary">📄 {ref}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
