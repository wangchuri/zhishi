import { Check } from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

/** 纸本风 Toaster：默认右上，浅纸底 + 海色描边 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      position="top-right"
      className="toaster group"
      gap={10}
      offset={16}
      icons={{
        success: <Check className="size-3.5 text-sea" strokeWidth={2.5} />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast !bg-paper !text-ink !border-line !shadow-[0_8px_28px_-12px_rgba(20,33,43,0.18)] " +
            "!rounded-2xl !font-[inherit] !gap-3 !px-4 !py-3.5",
          title: "!text-ink !text-body !font-medium !font-display",
          description: "!text-ink-soft !text-caption",
          success: "!border-sea/30 !bg-paper",
          error: "!border-danger/35 !bg-paper",
          warning: "!border-line !bg-paper",
          info: "!border-line !bg-paper",
          closeButton:
            "!bg-paper-2 !border-line !text-ink-soft hover:!bg-paper-deep hover:!text-ink",
          actionButton: "!bg-sea !text-paper",
          cancelButton: "!bg-paper-2 !text-ink-soft",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
