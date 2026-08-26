import type { ReactNode } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

export function RailOverlay({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "fixed left-0 right-0 bottom-0 z-50 transition-[visibility] duration-200",
        open ? "visible" : "invisible pointer-events-none",
      )}
      style={{ top: "calc(4rem + env(safe-area-inset-top, 0px))" }}
      aria-hidden={!open}
    >
      <button
        type="button"
        className={cn(
          "absolute inset-0 bg-ink/20 transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0",
        )}
        aria-label="关闭侧栏"
        onClick={onClose}
      />
      <aside
        className={cn(
          "absolute top-0 right-0 bottom-0 w-[20rem] max-w-[92vw] bg-paper border-l border-line flex flex-col",
          "shadow-[-16px_0_40px_rgba(20,33,43,0.12)] transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="h-14 px-5 flex items-center justify-between border-b border-line shrink-0">
          <h2 className="font-display text-title-s text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-ink-disabled hover:bg-paper-2 hover:text-ink transition-colors"
            aria-label="关闭"
          >
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto scroll-thin p-5">{children}</div>
      </aside>
    </div>
  )
}
