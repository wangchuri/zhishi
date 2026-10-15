import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Camera, ImagePlus, X } from "lucide-react"
import { uploadUrl } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { AttachmentItem } from "@/hooks/useImageAttachments"

/** 「+ 图片」按钮：<label> 包 input，靠原生 label 行为触发，不依赖 JS click
 *  （部分手机浏览器对 display:none 的 file input 不弹选择器）。 */
export function AttachImageButton({
  onFiles,
  disabled,
  className,
}: {
  onFiles: (files: FileList) => void
  disabled?: boolean
  className?: string
}) {
  return (
    <label
      role="button"
      aria-label="添加图片"
      title="添加图片（也可直接粘贴截图）"
      className={cn(
        "shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full text-ink-soft transition-colors cursor-pointer",
        "hover:bg-sea-subtle hover:text-sea",
        disabled && "opacity-50 pointer-events-none",
        className,
      )}
    >
      <ImagePlus className="w-[18px] h-[18px]" strokeWidth={2} />
      <input
        type="file"
        accept="image/*"
        multiple
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files)
          e.target.value = ""
        }}
      />
    </label>
  )
}

/** 「拍照」按钮：手机上直接调起后置相机（capture 让系统跳过选择器）。
 *  同样用 <label> 包 input，避免 JS click 在部分手机浏览器上不弹。
 *  桌面浏览器会忽略 capture，退化成普通文件选择，无副作用。 */
export function CaptureImageButton({
  onFiles,
  disabled,
  className,
}: {
  onFiles: (files: FileList) => void
  disabled?: boolean
  className?: string
}) {
  return (
    <label
      role="button"
      aria-label="拍照"
      title="拍照上传"
      className={cn(
        "shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full text-ink-soft transition-colors cursor-pointer",
        "hover:bg-sea-subtle hover:text-sea",
        disabled && "opacity-50 pointer-events-none",
        className,
      )}
    >
      <Camera className="w-[18px] h-[18px]" strokeWidth={2} />
      <input
        type="file"
        accept="image/*"
        capture="environment"
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files)
          e.target.value = ""
        }}
      />
    </label>
  )
}

function ImagePreview({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  // 必须 portal 到 body：消息气泡上的 .animate-msg-in 带 transform，
  // 会为 position:fixed 建立包含块，预览层就会被限制在气泡大小里（只剩 860×228）。
  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-ink/70 flex items-center justify-center p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <img src={src} alt="预览" className="max-w-full max-h-full rounded-lg shadow-lg" />
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭预览"
        className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/15 text-white flex items-center justify-center hover:bg-white/25"
      >
        <X className="w-5 h-5" strokeWidth={2} />
      </button>
    </div>,
    document.body,
  )
}

/** 待发送图片缩略图（可移除、可放大）。 */
export function AttachmentThumbnails({
  items,
  onRemove,
  className,
}: {
  items: AttachmentItem[]
  onRemove?: (id: string) => void
  className?: string
}) {
  const [preview, setPreview] = useState<string | null>(null)
  if (items.length === 0) return null
  return (
    <>
      <div className={cn("flex flex-wrap gap-2", className)}>
        {items.map((item) => (
          <div key={item.id} className="relative">
            <button type="button" onClick={() => setPreview(uploadUrl(item.id))} className="block">
              <img
                src={uploadUrl(item.id)}
                alt={item.name || "图片"}
                className="w-16 h-16 object-cover rounded-md border border-line bg-paper-2"
              />
            </button>
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                aria-label="移除图片"
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-ink text-white flex items-center justify-center shadow-xs"
              >
                <X className="w-3 h-3" strokeWidth={2.5} />
              </button>
            )}
          </div>
        ))}
      </div>
      {preview && <ImagePreview src={preview} onClose={() => setPreview(null)} />}
    </>
  )
}

/** 消息里回显的已发送图片（点击放大）。 */
export function MessageImages({ ids, className }: { ids?: string[]; className?: string }) {
  const [preview, setPreview] = useState<string | null>(null)
  if (!ids || ids.length === 0) return null
  return (
    <>
      <div className={cn("flex flex-wrap gap-2", className)}>
        {ids.map((id) => (
          <button key={id} type="button" onClick={() => setPreview(uploadUrl(id))} className="block">
            <img
              src={uploadUrl(id)}
              alt="图片"
              loading="lazy"
              className="max-h-48 max-w-full rounded-md border border-white/25 object-contain"
            />
          </button>
        ))}
      </div>
      {preview && <ImagePreview src={preview} onClose={() => setPreview(null)} />}
    </>
  )
}
