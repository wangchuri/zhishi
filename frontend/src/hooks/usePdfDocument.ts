import { useEffect, useState } from "react"
import { getDocument, type PDFDocumentLoadingTask, type PDFDocumentProxy } from "pdfjs-dist"
import "@/lib/pdfWorker"
import { kbApi } from "@/lib/api"

interface UsePdfDocumentResult {
  pdf: PDFDocumentProxy | null
  loading: boolean
  error: string | null
}

export type PdfSource =
  | { docId: string }
  | { data: ArrayBuffer }

function sourceKey(source: PdfSource | null): string {
  if (!source) return ""
  if ("docId" in source) return `doc:${source.docId}`
  return `data:${(source.data as ArrayBuffer).byteLength}`
}

export function usePdfDocument(
  source: PdfSource | null,
  enabled: boolean,
): UsePdfDocumentResult {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const key = sourceKey(source)

  useEffect(() => {
    if (!enabled || !source) {
      return
    }

    let cancelled = false
    let loadingTask: PDFDocumentLoadingTask | null = null

    setLoading(true)
    setError(null)
    setPdf(null)

    const loadData = async (): Promise<ArrayBuffer> => {
      // pdf.js 的 getDocument 会 transfer 传入的 ArrayBuffer（detach 原 buffer）。
      // 拷贝一份副本，避免多次使用同一 buffer 时报 detached 错误。
      if ("data" in source) {
        // 若传入的 buffer 已被 detach（不可再 slice），抛错让上层兜底
        try {
          new Uint8Array(source.data)
        } catch {
          throw new Error("PDF 数据缓冲区已失效，请重新上传")
        }
        return source.data.slice(0)
      }
      const blob = await kbApi.fetchDocumentFile(source.docId)
      return blob.arrayBuffer()
    }

    loadData()
      .then(async (data) => {
        if (cancelled) return
        loadingTask = getDocument({ data })
        const doc = await loadingTask.promise
        if (cancelled) {
          await loadingTask.destroy()
          return
        }
        setPdf(doc)
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setPdf(null)
          setError(err.message || "PDF 加载失败")
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      void loadingTask?.destroy()
    }
  }, [key, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  return { pdf, loading, error }
}
