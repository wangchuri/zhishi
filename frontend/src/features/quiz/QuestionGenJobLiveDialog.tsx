import { useEffect, useRef, useState } from "react"
import { Bot, Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { getWsUrl } from "@/lib/api"
import {
  applyStreamEvent,
  QuestionGenAgentBoard,
  type StreamLogItem,
} from "./QuestionGenStreamLog"

export function QuestionGenJobLiveDialog({
  jobId,
  open,
  onOpenChange,
}: {
  jobId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [items, setItems] = useState<StreamLogItem[]>([])
  const [connected, setConnected] = useState(false)
  const [finished, setFinished] = useState(false)
  const [title, setTitle] = useState("出题过程")
  const endRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !jobId) return
    setItems([])
    setConnected(false)
    setFinished(false)
    setTitle("出题过程")

    const ws = new WebSocket(getWsUrl(`/api/v1/questions/jobs/${jobId}/stream`))
    ws.onopen = () => setConnected(true)
    ws.onmessage = (msg) => {
      try {
        const ev = JSON.parse(msg.data)
        if (ev.event === "hello" && ev.job?.document_name) {
          setTitle(`正在出题 · ${ev.job.document_name}`)
        }
        if (ev.event === "done" || ev.event === "error") setFinished(true)
        setItems((prev) => applyStreamEvent(prev, ev))
      } catch {
        /* ignore */
      }
    }
    ws.onerror = () => {
      setItems((prev) => applyStreamEvent(prev, { event: "error", content: "WebSocket 连接失败" }))
      setFinished(true)
    }
    ws.onclose = () => setConnected(false)
    return () => {
      ws.close()
    }
  }, [open, jobId])

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80
    if (nearBottom) endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [items])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-line-soft shrink-0">
          <DialogTitle className="flex items-center gap-2 text-body">
            <Bot className="w-4 h-4 text-sea" />
            <span className="truncate">{title}</span>
            {!finished && connected && <Loader2 className="w-3.5 h-3.5 animate-spin text-sea shrink-0" />}
          </DialogTitle>
          <DialogDescription>
            {finished ? "本次出题已结束" : "每页一个 Agent，按 id 分栏；思考默认折叠"}
          </DialogDescription>
        </DialogHeader>
        <div ref={boxRef} className="flex-1 min-h-[360px] overflow-y-auto scroll-thin bg-paper-2 px-5 py-4">
          {items.length === 0 && (
            <p className="text-caption text-ink-disabled text-center py-10">
              {connected ? "等待 Agent 输出…" : "正在连接…"}
            </p>
          )}
          <QuestionGenAgentBoard items={items} finished={finished} layout="grid" />
          <div ref={endRef} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
