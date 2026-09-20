import { useEffect, useMemo, useState } from "react"
import { GitBranch, List, Loader2 } from "lucide-react"
import { kbApi } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { LearningPathResult } from "@/types"

const ROW = 26
const ROOT_X = 4
const CH_X = 118
const KP_X = 288
const ROOT_W = 96
const CH_W = 156
const KP_W = 150

interface Node {
  x: number
  y: number
  w: number
  label: string
  kind: "root" | "chapter" | "point"
  learned?: boolean
}

function truncate(text: string, n: number) {
  const t = (text || "").trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** 书本目录 ⇄ 书本思维大纲 */
export function BookOutline({ documentId }: { documentId: string }) {
  const [data, setData] = useState<LearningPathResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<"list" | "map">("list")

  useEffect(() => {
    let cancelled = false
    kbApi
      .getLearningPath(documentId)
      .then((r) => {
        if (!cancelled) setData(r)
      })
      .catch(() => {
        if (!cancelled) setData(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [documentId])

  const chapters = useMemo(() => data?.chapters || [], [data])

  const graph = useMemo(() => {
    const nodes: Node[] = []
    const links: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
    let y = 14
    const chapterNodes: Node[] = []
    const chapterRows: Array<{ x: number; y: number }[]> = []

    for (const ch of chapters) {
      const kps = (ch.key_points || []).filter(Boolean)
      const rows = Math.max(1, kps.length)
      const blockTop = y
      const blockH = rows * ROW
      const chY = blockTop + blockH / 2
      const chNode: Node = {
        x: CH_X,
        y: chY,
        w: CH_W,
        label: truncate(ch.title || "章节", 12),
        kind: "chapter",
        learned: ch.learned,
      }
      nodes.push(chNode)
      chapterNodes.push(chNode)
      const pts: Array<{ x: number; y: number }> = []
      kps.forEach((kp, i) => {
        const py = blockTop + i * ROW + ROW / 2
        nodes.push({ x: KP_X, y: py, w: KP_W, label: truncate(kp, 12), kind: "point" })
        pts.push({ x: KP_X, y: py })
      })
      chapterRows.push(pts)
      y += blockH + 10
    }

    const height = Math.max(60, y)
    const rootNode: Node = {
      x: ROOT_X,
      y: height / 2,
      w: ROOT_W,
      label: truncate(data?.title || "本书", 7),
      kind: "root",
    }
    nodes.unshift(rootNode)
    for (const chNode of chapterNodes) {
      links.push({ x1: ROOT_X + ROOT_W, y1: rootNode.y, x2: CH_X, y2: chNode.y })
    }
    chapterRows.forEach((pts, ci) => {
      const chNode = chapterNodes[ci]
      for (const p of pts) {
        links.push({ x1: CH_X + CH_W, y1: chNode.y, x2: KP_X, y2: p.y })
      }
    })
    return { nodes, links, height, width: KP_X + KP_W + 8 }
  }, [chapters, data?.title])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-ink-disabled gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> 读取目录…
      </div>
    )
  }

  if (chapters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-ink-disabled gap-2 px-4 text-center">
        <List className="w-5 h-5" strokeWidth={1.8} />
        <span className="text-caption">这本书还没有目录。可在资料页生成学习路径。</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <button
        type="button"
        onClick={() => setView((v) => (v === "list" ? "map" : "list"))}
        className="flex items-center gap-2 px-3 py-2 border-b border-line-light text-left shrink-0 hover:bg-sea-subtle/40 transition-colors"
        title="点击切换目录 / 思维大纲"
      >
        {view === "list" ? (
          <GitBranch className="w-4 h-4 text-sea" strokeWidth={2} />
        ) : (
          <List className="w-4 h-4 text-sea" strokeWidth={2} />
        )}
        <span className="font-display text-title-s text-ink">
          {view === "list" ? "书本目录" : "书本思维大纲"}
        </span>
        <span className="ml-auto text-[11px] text-sea">点我切换</span>
      </button>

      {view === "list" ? (
        <ol className="flex-1 overflow-y-auto scroll-thin p-3 space-y-2 list-none">
          {chapters.map((ch, i) => (
            <li key={ch.id || i} className="rounded-lg border border-line-light bg-paper-2/40 px-2.5 py-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-ink-disabled tabular-nums">{i + 1}</span>
                <span className={cn("text-caption text-ink", ch.learned && "text-sea")}>
                  {ch.title}
                </span>
                {ch.learned ? <span className="text-[10px] text-sea ml-auto">学过</span> : null}
              </div>
              {(ch.key_points || []).length > 0 ? (
                <div className="flex flex-wrap gap-1 mt-1">
                  {(ch.key_points || []).map((kp) => (
                    <span
                      key={kp}
                      className="h-5 px-1.5 rounded-full bg-sea-subtle text-sea text-[10px] leading-5"
                    >
                      {kp}
                    </span>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <div className="flex-1 overflow-auto scroll-thin p-2">
          <svg
            width={graph.width}
            height={graph.height}
            viewBox={`0 0 ${graph.width} ${graph.height}`}
            role="img"
            aria-label="书本思维大纲"
          >
            {graph.links.map((l, i) => (
              <path
                key={i}
                d={`M${l.x1},${l.y1} C${l.x1 + 24},${l.y1} ${l.x2 - 24},${l.y2} ${l.x2},${l.y2}`}
                fill="none"
                stroke="var(--mist)"
                strokeWidth={1}
              />
            ))}
            {graph.nodes.map((n, i) => (
              <g key={i}>
                <rect
                  x={n.x}
                  y={n.y - 11}
                  width={n.w}
                  height={22}
                  rx={4}
                  fill={
                    n.kind === "root"
                      ? "var(--ink)"
                      : n.kind === "chapter"
                        ? n.learned
                          ? "var(--sea-subtle)"
                          : "var(--paper-2)"
                        : "var(--paper)"
                  }
                  stroke="var(--line)"
                  strokeWidth={1}
                />
                <text
                  x={n.x + 8}
                  y={n.y + 4}
                  fontSize={n.kind === "root" ? 11 : 10.5}
                  fill={n.kind === "root" ? "var(--paper)" : n.learned ? "var(--sea)" : "var(--ink)"}
                  fontFamily="Outfit, 'PingFang SC', 'Microsoft YaHei', sans-serif"
                >
                  {n.label}
                </text>
              </g>
            ))}
          </svg>
        </div>
      )}
    </div>
  )
}
