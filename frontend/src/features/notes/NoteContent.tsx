import { useMemo } from "react"
import { MarkdownWithMath } from "@/components/blocks/MarkdownWithMath"
import { EmbedCard, type EmbedKind } from "@/features/notes/EmbedCard"

/** 嵌入指令：[[tip:id|style]] / [[question:id]] / [[material:id]] */
const EMBED_RE = /\[\[\s*(tip|question|material)\s*:\s*([A-Za-z0-9_-]+)\s*(?:\|\s*([a-z]+)\s*)?\]\]/gi

interface EmbedSpec {
  kind: EmbedKind
  id: string
  style?: string
}

type Segment =
  | { type: "md"; text: string }
  | { type: "embed"; spec: EmbedSpec }

export function NoteContent({ content }: { content: string }) {
  const segments = useMemo<Segment[]>(() => {
    const out: Segment[] = []
    const re = new RegExp(EMBED_RE.source, "gi")
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      if (m.index > last) out.push({ type: "md", text: content.slice(last, m.index) })
      out.push({
        type: "embed",
        spec: {
          kind: m[1].toLowerCase() as EmbedKind,
          id: m[2],
          style: m[3],
        },
      })
      last = m.index + m[0].length
    }
    if (last < content.length) out.push({ type: "md", text: content.slice(last) })
    if (out.length === 0) out.push({ type: "md", text: content })
    return out
  }, [content])

  return (
    <>
      {segments.map((seg, i) =>
        seg.type === "md" ? (
          <MarkdownWithMath key={i}>{seg.text}</MarkdownWithMath>
        ) : (
          <EmbedCard key={i} {...seg.spec} />
        ),
      )}
    </>
  )
}
