import { Sparkles } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { ChatMessage as ChatMessageType } from "@/types"
import { CitationCard } from "@/components/blocks/CitationCard"
import { cn } from "@/lib/utils"

interface ChatMessageProps {
  message: ChatMessageType
  className?: string
}

export function ChatMessage({ message, className }: ChatMessageProps) {
  const isUser = message.role === "user"

  if (isUser) {
    return (
      <div className={cn("flex justify-end animate-msg-in", className)}>
        <div className="max-w-[72%] bg-primary text-white rounded-lg rounded-tr-sm px-4 py-2.5 text-body leading-relaxed shadow-xs">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className={cn("flex gap-3 animate-msg-in", className)}>
      <div className="w-8 h-8 rounded-full bg-gradient-primary flex items-center justify-center shrink-0 shadow-primary">
        <Sparkles className="w-4 h-4 text-white" strokeWidth={2} />
      </div>
      <div className="max-w-[78%] bg-surface border border-line-soft rounded-lg rounded-tl-sm px-4 py-2.5 text-body text-ink-primary leading-relaxed shadow-xs">
        <div className="text-card-title font-semibold text-ink-primary mb-1 flex items-center gap-1.5">
          Tina
          <span className="text-small text-ink-tertiary font-normal">· 知识库助手</span>
        </div>
        <div className="prose prose-sm prose-headings:text-ink-primary prose-p:text-ink-primary prose-strong:text-ink-primary prose-a:text-primary prose-code:bg-surface-soft prose-code:px-1 prose-code:rounded prose-code:text-small prose-pre:bg-surface-soft prose-pre:border prose-pre:border-line-soft max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        </div>
        {message.citations && message.citations.length > 0 && (
          <div className="mt-3 pt-3 border-t border-line-soft space-y-1.5">
            <div className="text-small text-ink-tertiary">引用来源：</div>
            {message.citations.map((c, i) => (
              <CitationCard key={i} citation={c} variant="inline" />
            ))}
          </div>
        )}
        {message.refs && message.refs.length > 0 && (
          <div className="mt-3 pt-3 border-t border-line-soft space-y-1">
            <div className="text-small text-ink-tertiary">引用文档：</div>
            {message.refs.map((ref, i) => (
              <div key={i} className="text-small text-primary hover:underline cursor-pointer">📄 {ref}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
