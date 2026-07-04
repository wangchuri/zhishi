import { useEffect, useState } from "react"
import { getDocument, type PDFDocumentLoadingTask, type PDFDocumentProxy } from "pdfjs-dist"
import "@/lib/pdfWorker"
import { kbApi } from "@/lib/api"

interface UsePdfDocumentResult {
  pdf: PDFDocumentProxy | null
  loading: boolean
  error: string | null
}

export function usePdfDocument(docId: string | null, enabled: boolean): UsePdfDocumentResult {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled || !docId) {
      setPdf(null)
      setError(null)
      setLoading(false)
      return
    }

    let cancelled = false
    let loadingTask: PDFDocumentLoadingTask | null = null

    setLoading(true)
    setError(null)
    setPdf(null)

    kbApi
      .fetchDocumentFile(docId)
      .then(async (blob) => {
        const data = await blob.arrayBuffer()
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
  }, [docId, enabled])

  return { pdf, loading, error }
}
