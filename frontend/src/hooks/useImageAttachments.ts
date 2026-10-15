import { useCallback, useState } from "react"
import { uploadsApi } from "@/lib/api"

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
    const list = files ? Array.from(files).filter((f) => f.type.startsWith("image/")) : []
    if (list.length === 0) return
    setUploading(true)
    setError(null)
    try {
      const uploaded: AttachmentItem[] = []
      for (const file of list) {
        const res = await uploadsApi.uploadImage(file)
        uploaded.push({ id: res.id, url: res.url, name: res.filename })
      }
      setItems((prev) => [...prev, ...uploaded])
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
