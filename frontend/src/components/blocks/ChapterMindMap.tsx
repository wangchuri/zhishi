import { useMemo } from "react"
import { cn } from "@/lib/utils"
import type { LearningPathChapter } from "@/types"

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
  chapterIndex?: number
}

function truncate(text: string, n: number) {
  const t = (text || "").trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/**
 * 书本思维大纲：由章节 + 要点画出的横向思维导图。
 * 供笔记侧栏与资料详情页共用。
 */
export function ChapterMindMap({
  chapters,
  title,
  activeChapter = null,
  onPickChapter,
  className,
}: {
  chapters: LearningPathChapter[]
  title?: string | null
  activeChapter?: number | null
  onPickChapter?: (index: number) => void
  className?: string
}) {
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
        chapterIndex: chapterNodes.length,
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
      label: truncate(title || "本书", 7),
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
  }, [chapters, title])

  return (
    <div className={cn("overflow-auto scroll-thin p-2", className || "flex-1")}>
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
        {graph.nodes.map((n, i) => {
          const active = n.kind === "chapter" && n.chapterIndex === activeChapter
          const clickable = n.kind === "chapter" && !!onPickChapter
          return (
            <g
              key={i}
              onClick={clickable ? () => onPickChapter?.(n.chapterIndex ?? 0) : undefined}
              className={clickable ? "cursor-pointer" : undefined}
            >
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
                      ? active
                        ? "var(--sea)"
                        : n.learned
                          ? "var(--sea-subtle)"
                          : "var(--paper-2)"
                      : "var(--paper)"
                }
                stroke={active ? "var(--sea)" : "var(--line)"}
                strokeWidth={active ? 1.5 : 1}
              />
              <text
                x={n.x + 8}
                y={n.y + 4}
                fontSize={n.kind === "root" ? 11 : 10.5}
                fill={
                  n.kind === "root" || active
                    ? "var(--paper)"
                    : n.learned
                      ? "var(--sea)"
                      : "var(--ink)"
                }
                fontFamily="Outfit, 'PingFang SC', 'Microsoft YaHei', sans-serif"
              >
                {n.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
