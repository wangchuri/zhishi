import { useState, type ReactNode } from "react"
import { Bot, CheckCircle2, ChevronDown, ChevronRight, Loader2, Wrench, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"

export type StreamLogItem = {
  id: number
  kind: "think" | "text" | "tool" | "status" | "done" | "error" | "meta"
  text: string
  agentId?: string
  page?: number
}

export type StreamLogEvent = {
  event: string
  content?: string
  reasoning?: string
  tool_name?: string
  submitted?: number
  questions_created?: number
  total_questions?: number
  page?: number
  count?: number
  agent_id?: string
}

let logSeq = 0

const TOOL_LABEL: Record<string, string> = {
  submit_single_choice: "提交单选题",
  submit_fill_blank: "提交填空题",
  submit_short_answer: "提交简答题",
  submit_application: "提交应用题",
  submit_custom_question: "提交自定义题",
  search_document_content: "检索选中页",
  get_near_page: "取相邻页",
}

export function shortToolName(raw: string): string {
  const n = String(raw || "tool").replace(/^question_gen_/, "").trim()
  return TOOL_LABEL[n] || n || "tool"
}

function mergeToolNames(prevText: string, incoming: string[]): string {
  const have = prevText.split("\n").filter(Boolean)
  const seen = new Set(have)
  for (const n of incoming) {
    if (!seen.has(n)) {
      seen.add(n)
      have.push(n)
    }
  }
  return have.join("\n")
}

function sameAgent(item: StreamLogItem, ev: StreamLogEvent): boolean {
  return (item.agentId || "") === (ev.agent_id || "")
}

function lastIndexOf(
  items: StreamLogItem[],
  kind: StreamLogItem["kind"],
  ev: StreamLogEvent,
): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === kind && sameAgent(items[i], ev)) return i
  }
  return -1
}

function withAgent(item: Omit<StreamLogItem, "id">, ev: StreamLogEvent): StreamLogItem {
  return {
    id: ++logSeq,
    ...item,
    agentId: ev.agent_id,
    page: ev.page ?? item.page,
  }
}

function patchAt(items: StreamLogItem[], index: number, text: string): StreamLogItem[] {
  const target = items[index]
  return [...items.slice(0, index), { ...target, text }, ...items.slice(index + 1)]
}

function lastItemIndexForAgent(items: StreamLogItem[], ev: StreamLogEvent): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (sameAgent(items[i], ev) && items[i].kind !== "meta") return i
  }
  return -1
}

function appendChunk(
  items: StreamLogItem[],
  kind: "think" | "text",
  piece: string,
  ev: StreamLogEvent,
): StreamLogItem[] {
  if (!piece) return items
  const idx = lastItemIndexForAgent(items, ev)
  if (idx >= 0 && items[idx].kind === kind) {
    return patchAt(items, idx, items[idx].text + piece)
  }
  return [...items, withAgent({ kind, text: piece }, ev)]
}

export function applyStreamEvent(items: StreamLogItem[], ev: StreamLogEvent): StreamLogItem[] {
  if (ev.event === "hello") return items
  if (ev.event === "agent_queued") {
    return [...items, withAgent({ kind: "meta", text: "queued", page: ev.page }, ev)]
  }
  if (ev.event === "agent_start") {
    const idx = lastIndexOf(items, "meta", ev)
    if (idx >= 0 && items[idx].text === "queued") {
      return patchAt(items, idx, "running")
    }
    return [...items, withAgent({ kind: "meta", text: "running", page: ev.page }, ev)]
  }
  if (ev.event === "chunk") {
    let next = items
    if (ev.reasoning) next = appendChunk(next, "think", ev.reasoning, ev)
    if (ev.content) next = appendChunk(next, "text", ev.content, ev)
    return next
  }
  if (ev.event === "tool") {
    const names = String(ev.tool_name || "tool")
      .split(/[、,]/)
      .map((s) => shortToolName(s))
      .filter(Boolean)
    if (names.length === 0) return items
    const idx = lastItemIndexForAgent(items, ev)
    if (idx >= 0 && items[idx].kind === "tool") {
      return patchAt(items, idx, mergeToolNames(items[idx].text, names))
    }
    return [...items, withAgent({ kind: "tool", text: mergeToolNames("", names) }, ev)]
  }
  if (ev.event === "page_done") {
    const idx = lastIndexOf(items, "meta", ev)
    let next = items
    if (idx >= 0) next = patchAt(next, idx, "done")
    return [
      ...next,
      withAgent({ kind: "done", text: `本页完成（${ev.count ?? 0} 题）` }, ev),
    ]
  }
  if (ev.event === "page_error") {
    const idx = lastIndexOf(items, "meta", ev)
    let next = items
    if (idx >= 0) next = patchAt(next, idx, "error")
    return [...next, withAgent({ kind: "error", text: ev.content || `第 ${ev.page} 页出题失败` }, ev)]
  }
  if (ev.event === "status") {
    const text = ev.content || `已提交 ${ev.submitted ?? 0} 题`
    const idx = lastItemIndexForAgent(items, ev)
    if (
      idx >= 0 &&
      items[idx].kind === "status" &&
      items[idx].text.includes("已提交") &&
      text.includes("已提交")
    ) {
      return patchAt(items, idx, text)
    }
    return [...items, withAgent({ kind: "status", text }, ev)]
  }
  if (ev.event === "done" || ev.event === "result") {
    const n = ev.questions_created ?? ev.total_questions ?? ev.submitted
    const text = n != null ? `全部结束，共 ${n} 题` : "出题结束"
    return [...items, { id: ++logSeq, kind: "done", text }]
  }
  if (ev.event === "error") {
    return [...items, withAgent({ kind: "error", text: ev.content || "出错了" }, ev)]
  }
  return items
}

function ThinkFold({ text, live }: { text: string; live?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border border-line bg-paper/70">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left text-caption text-ink-soft hover:text-ink"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
        <span className="font-medium">{live ? "思考中" : "思考过程"}</span>
        {live && <Loader2 className="w-3 h-3 animate-spin shrink-0" />}
        <span className="ml-auto text-ink-disabled">{text.length} 字</span>
      </button>
      {open && (
        <div className="px-3 pb-2.5 text-caption text-ink-disabled leading-relaxed whitespace-pre-wrap border-t border-line-light pt-2">
          {text}
        </div>
      )}
    </div>
  )
}

export function QuestionGenStreamLog({
  items,
  finished = false,
}: {
  items: StreamLogItem[]
  finished?: boolean
}) {
  const visible = items.filter((x) => x.kind !== "meta")
  if (visible.length === 0) return null

  const lastId = visible[visible.length - 1]?.id
  const nodes: ReactNode[] = []

  for (const item of visible) {
    if (item.kind === "tool") {
      const names = item.text.split("\n").filter(Boolean)
      nodes.push(
        <div key={item.id} className="flex flex-wrap gap-1.5">
          {names.map((name, idx) => (
            <span
              key={`${item.id}-${idx}`}
              className="inline-flex items-center gap-1 rounded-full border border-sea/25 bg-sea-subtle px-2 py-0.5 text-caption text-sea"
            >
              <Wrench className="w-3 h-3" />
              {name}
            </span>
          ))}
        </div>,
      )
      continue
    }
    if (item.kind === "think") {
      nodes.push(
        <ThinkFold
          key={item.id}
          text={item.text}
          live={!finished && item.id === lastId}
        />,
      )
      continue
    }
    if (item.kind === "text") {
      nodes.push(
        <div key={item.id} className="text-small text-ink leading-relaxed whitespace-pre-wrap">
          {item.text}
        </div>,
      )
      continue
    }
    if (item.kind === "status") {
      nodes.push(
        <div key={item.id} className="text-caption text-ink-disabled">
          {item.text}
        </div>,
      )
      continue
    }
    if (item.kind === "done") {
      nodes.push(
        <div key={item.id} className="flex items-center gap-1.5 text-caption font-medium text-success">
          <CheckCircle2 className="w-3.5 h-3.5" />
          {item.text}
        </div>,
      )
      continue
    }
    nodes.push(
      <div key={item.id} className="flex items-center gap-1.5 text-caption text-danger">
        <XCircle className="w-3.5 h-3.5" />
        {item.text}
      </div>,
    )
  }

  return <div className={cn("space-y-2.5")}>{nodes}</div>
}

type AgentPhase = "queued" | "running" | "done" | "error"

type AgentColumn = {
  agentId: string
  page?: number
  phase: AgentPhase
  items: StreamLogItem[]
}

function phaseOf(items: StreamLogItem[]): AgentPhase {
  const meta = [...items].reverse().find((x) => x.kind === "meta")
  if (meta?.text === "error" || items.some((x) => x.kind === "error")) return "error"
  if (meta?.text === "done" || items.some((x) => x.kind === "done")) return "done"
  if (meta?.text === "running" || items.some((x) => x.kind !== "meta")) return "running"
  return "queued"
}

export function groupStreamByAgent(items: StreamLogItem[]): {
  global: StreamLogItem[]
  columns: AgentColumn[]
} {
  const global: StreamLogItem[] = []
  const order: string[] = []
  const map = new Map<string, StreamLogItem[]>()
  for (const it of items) {
    if (!it.agentId) {
      global.push(it)
      continue
    }
    if (!map.has(it.agentId)) {
      map.set(it.agentId, [])
      order.push(it.agentId)
    }
    map.get(it.agentId)!.push(it)
  }
  const columns = order.map((id) => {
    const colItems = map.get(id)!
    const page = colItems.find((x) => x.page != null)?.page
    return { agentId: id, page, phase: phaseOf(colItems), items: colItems }
  })
  return { global, columns }
}

function AgentCard({
  column,
  finished,
  layout,
}: {
  column: AgentColumn
  finished: boolean
  layout: "stack" | "grid"
}) {
  const live = column.phase === "running" && !finished
  return (
    <div
      className={cn(
        "rounded-md border bg-paper flex flex-col min-h-0 overflow-hidden",
        column.phase === "running" && "border-sea/40",
        column.phase === "done" && "border-line",
        column.phase === "error" && "border-danger/40",
        column.phase === "queued" && "border-line-light",
        layout === "grid" && "min-w-[240px] max-h-[52vh]",
        layout === "stack" && "max-h-[280px]",
      )}
    >
      <div className="px-2.5 py-1.5 border-b border-line-light flex items-center gap-1.5 shrink-0">
        <Bot className="w-3.5 h-3.5 text-sea shrink-0" />
        <span className="font-mono text-caption text-sea font-medium">#{column.agentId}</span>
        {column.page != null && (
          <span className="text-caption text-ink-soft">第 {column.page} 页</span>
        )}
        <span className="ml-auto flex items-center gap-1 text-caption text-ink-disabled">
          {live && <Loader2 className="w-3 h-3 animate-spin text-sea" />}
          {column.phase === "done" && <CheckCircle2 className="w-3 h-3 text-success" />}
          {column.phase === "error" && <XCircle className="w-3 h-3 text-danger" />}
          {column.phase === "queued" && "排队"}
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin p-2.5">
        {column.phase === "queued" ? (
          <p className="text-caption text-ink-disabled">等待空闲槽位…</p>
        ) : (
          <QuestionGenStreamLog items={column.items} finished={!live} />
        )}
      </div>
    </div>
  )
}

export function QuestionGenAgentBoard({
  items,
  finished = false,
  layout = "stack",
}: {
  items: StreamLogItem[]
  finished?: boolean
  layout?: "stack" | "grid"
}) {
  if (items.length === 0) return null
  const { global, columns } = groupStreamByAgent(items)
  const queued = columns.filter((c) => c.phase === "queued")
  const active = columns.filter((c) => c.phase !== "queued")
  const running = columns.filter((c) => c.phase === "running").length

  if (columns.length === 0) {
    return <QuestionGenStreamLog items={items} finished={finished} />
  }

  return (
    <div className="space-y-3">
      <div className="text-caption text-ink-disabled">
        {running > 0 ? `${running} 路进行中` : finished ? "全部结束" : "等待启动"}
        {queued.length > 0 && ` · ${queued.length} 路排队`}
        {columns.length > 0 && ` · 共 ${columns.length} 个 Agent`}
      </div>
      {queued.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {queued.map((c) => (
            <span
              key={c.agentId}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2 py-0.5 text-caption text-ink-disabled"
            >
              <span className="font-mono">#{c.agentId}</span>
              {c.page != null && <span>第 {c.page} 页</span>}
            </span>
          ))}
        </div>
      )}
      {active.length > 0 && (
        <div
          className={cn(
            layout === "grid"
              ? "flex gap-3 overflow-x-auto scroll-thin pb-1"
              : "flex flex-col gap-3",
          )}
        >
          {active.map((c) => (
            <div key={c.agentId} className={cn(layout === "grid" && "flex-1 min-w-[240px] max-w-sm")}>
              <AgentCard column={c} finished={finished} layout={layout} />
            </div>
          ))}
        </div>
      )}
      {global.length > 0 && <QuestionGenStreamLog items={global} finished={finished} />}
    </div>
  )
}
