import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import type { ChatMessage as ChatMessageType, Citation } from "@/types"
import { CitationCard } from "@/components/blocks/CitationCard"
import { ChatQuestionCard, type ChatQuestionWidget } from "@/features/chat/ChatQuestionCard"
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
  widgetsDisabled?: boolean
}

function ReasoningBlock({
  content,
  defaultOpen = false,
  crimson = false,
}: {
  content: string
  defaultOpen?: boolean
  crimson?: boolean
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
        <ThinkingLabel />
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
}: {
  content: string
  crimson?: boolean
}) {
  const bursts = parseTinaBursts(content)
  return (
    <div className="space-y-2.5">
      {bursts.map((b, i) => (
        <div
          key={i}
          className={cn(
            "rounded-[12px] border px-3.5 py-2.5",
            crimson ? "border-danger/25 bg-danger-soft/40" : "border-line-light bg-paper-2/80",
          )}
        >
          {b.text ? (
            <MarkdownWithMath proseClass={crimson ? markdownProseDangerClass : undefined}>
              {b.text}
            </MarkdownWithMath>
          ) : null}
        </div>
      ))}
    </div>
  )
}

export function ChatMessage({
  message,
  className,
  onCitationClick,
  onWidgetResolved,
  onOnboardingAction,
  widgetsDisabled,
}: ChatMessageProps) {
  const isUser = message.role === "user"
  const crimson = Boolean(message.crimson)
  const glitch = Boolean(message.glitch)
  const bursty = !isUser && !glitch && hasTinaMoodMarkup(message.content || "")

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
      <div className={cn("text-body leading-relaxed", crimson ? "text-danger" : "text-ink")}>
        {message.reasoning_content && (
          <ReasoningBlock
            content={message.reasoning_content}
            defaultOpen={glitch}
            crimson={crimson}
          />
        )}
        {glitch ? (
          <div className="text-danger whitespace-pre-wrap break-all leading-relaxed">
            {message.content}
          </div>
        ) : bursty ? (
          <TinaBurstStack content={message.content || ""} crimson={crimson} />
        ) : (
          <MarkdownWithMath proseClass={crimson ? markdownProseDangerClass : undefined}>
            {message.content}
          </MarkdownWithMath>
        )}
        {(message.payload?.widgets || []).map((w) => (
          <ChatQuestionCard
            key={w.question.question_id}
            widget={w as ChatQuestionWidget}
            chatMessageId={message.id}
            disabled={widgetsDisabled}
            onResolved={(next, followUp) => onWidgetResolved?.(next.question.question_id, next, followUp)}
          />
        ))}
        {(message.payload?.onboarding || []).map((item, i) => {
          if (item.type === "goal_card" && item.goal) {
            return (
              <OnboardingGoalCard
                key={`${message.id}-goal-${i}`}
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
                key={`${message.id}-docs-${i}`}
                locked={widgetsDisabled}
                busy={widgetsDisabled}
                onSkip={() => onOnboardingAction?.("先跳过资料。")}
              />
            )
          }
          if (item.type === "done") {
            return <OnboardingDoneCard key={`${message.id}-done-${i}`} />
          }
          return null
        })}
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
