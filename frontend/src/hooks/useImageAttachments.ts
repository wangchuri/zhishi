import { useCallback, useState } from "react"
import { uploadsApi } from "@/lib/api"
import { compressImageFile } from "@/lib/imageCompress"

export interface AttachmentItem {
  id: string
  url: string
  name?: string
}

/** 图片附件：选/粘文件 → 即时上传 → 得到 id 列表，随消息一起发。 */
export function useImageAttachments() {
  const [items, setItems] = useState<AttachmentItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addFiles = useCallback(async (files: FileList | File[] | null | undefined) => {
    const all = files ? Array.from(files) : []
    if (all.length === 0) return
    const list = all.filter((f) => f.type.startsWith("image/"))
    const skipped = all.length - list.length
    if (list.length === 0) {
      // 以前是静默丢弃，用户以为点了没反应
      setError("只能上传图片文件（jpg / png / webp / heic 等）")
      return
    }
    setUploading(true)
    setError(null)
    try {
      const uploaded: AttachmentItem[] = []
      for (const file of list) {
        // 手机照片动辄几 MB：先压到长边 1600px，失败则原样上传
        const prepared = await compressImageFile(file)
        const res = await uploadsApi.uploadImage(prepared)
        uploaded.push({ id: res.id, url: res.url, name: res.filename })
      }
      setItems((prev) => [...prev, ...uploaded])
      if (skipped > 0) setError(`已忽略 ${skipped} 个非图片文件`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "图片上传失败")
    } finally {
      setUploading(false)
    }
  }, [])

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const clear = useCallback(() => setItems([]), [])

  return { items, ids: items.map((i) => i.id), uploading, error, addFiles, remove, clear }
}
