import { useRef, useState } from "react"
import { ImagePlus, X } from "lucide-react"
import { uploadUrl } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { AttachmentItem } from "@/hooks/useImageAttachments"

/** 「+ 图片」按钮（内含隐藏 file input）。 */
export function AttachImageButton({
  onFiles,
  disabled,
  className,
}: {
  onFiles: (files: FileList) => void
  disabled?: boolean
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files)
          e.target.value = ""
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        aria-label="添加图片"
        title="添加图片（也可直接粘贴截图）"
        className={cn(
          "shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full text-ink-soft transition-colors",
          "hover:bg-sea-subtle hover:text-sea disabled:opacity-50 disabled:pointer-events-none",
          className,
        )}
      >
        <ImagePlus className="w-[18px] h-[18px]" strokeWidth={2} />
      </button>
    </>
  )
}

function ImagePreview({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[100] bg-ink/70 flex items-center justify-center p-6"
      onClick={onClose}
      role="presentation"
    >
      <img src={src} alt="预览" className="max-w-full max-h-full rounded-lg shadow-lg" />
    </div>
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
