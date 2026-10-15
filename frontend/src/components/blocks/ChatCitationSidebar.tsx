import { PanelRightClose, PanelRightOpen } from "lucide-react"
import type { Citation } from "@/types"
import { CitationCard } from "@/components/blocks/CitationCard"
import { cn } from "@/lib/utils"
import { MarkdownWithMath } from "@/components/blocks/MarkdownWithMath"

interface ChatCitationSidebarProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  citation: Citation | null
}

/** 聊天页右侧引用侧栏；手机端改为覆盖层，关时完全隐藏 */
export function ChatCitationSidebar({ open, onOpenChange, citation }: ChatCitationSidebarProps) {
  return (
    <>
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-[65] bg-ink/40 backdrop-blur-[2px]"
          onClick={() => onOpenChange(false)}
        />
      )}
      <div
        className={cn(
          "shrink-0 border-l border-line-soft bg-surface/60 flex-col transition-all duration-200",
          open ? "w-[320px] flex" : "w-[44px] flex max-lg:hidden",
          open && "max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-[70] max-lg:w-[88%] max-lg:max-w-[380px] max-lg:bg-paper max-lg:shadow-xl max-lg:pt-[env(safe-area-inset-top)] max-lg:pb-[env(safe-area-inset-bottom)]",
        )}
      >
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-3 border-b border-line-soft",
          !open && "justify-center px-0"
        )}
      >
        {open && (
          <span className="text-card-title font-semibold text-ink-primary flex-1 truncate">
            引用来源
          </span>
        )}
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          className="w-7 h-7 rounded-md flex items-center justify-center text-ink-tertiary hover:text-ink-primary hover:bg-surface-soft transition-colors shrink-0"
          title={open ? "折叠引用侧栏" : "展开引用侧栏"}
        >
          {open ? (
            <PanelRightClose className="w-4 h-4" strokeWidth={2} />
          ) : (
            <PanelRightOpen className="w-4 h-4" strokeWidth={2} />
          )}
        </button>
      </div>

      {open ? (
        <div className="flex-1 overflow-y-auto scroll-thin p-4">
          {!citation ? (
            <div className="text-small text-ink-tertiary text-center py-12 px-2">
              点击消息中的引用标题，在此查看文档片段；点击「查看文档」进入全文
            </div>
          ) : (
            <div className="space-y-4 animate-panel-in">
              <CitationCard citation={citation} variant="default" />
              {citation.snippet && (
                <section>
                  <h4 className="text-small font-medium text-ink-secondary mb-2">文档片段</h4>
                  <div className="rounded-lg border border-line-soft bg-surface-soft p-3 text-small text-ink-primary leading-relaxed max-h-[50dvh] overflow-y-auto scroll-thin">
                    <MarkdownWithMath proseClass="prose prose-sm max-w-none prose-p:my-1 prose-p:text-ink-primary">
                      {citation.snippet}
                    </MarkdownWithMath>
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <button
            type="button"
            onClick={() => onOpenChange(true)}
            className="flex flex-col items-center gap-1.5 text-ink-tertiary hover:text-primary transition-colors py-8"
            title="展开引用侧栏"
          >
            <PanelRightOpen className="w-4 h-4" strokeWidth={2} />
            <span className="text-caption font-medium [writing-mode:vertical-rl] tracking-wider">
              引用
            </span>
          </button>
        </div>
      )}
      </div>
    </>
  )
}
