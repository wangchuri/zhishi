import type { ChatMessage as ChatMessageType, Citation } from "@/types"
import { CitationCard } from "@/components/blocks/CitationCard"
import { MarkdownWithMath } from "@/components/blocks/MarkdownWithMath"
import { cn } from "@/lib/utils"

interface ChatMessageProps {
  message: ChatMessageType
  className?: string
  onCitationClick?: (citation: Citation) => void
}

export function ChatMessage({ message, className, onCitationClick }: ChatMessageProps) {
  const isUser = message.role === "user"

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
      <div className="text-body text-ink leading-relaxed">
        <MarkdownWithMath>{message.content}</MarkdownWithMath>
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
