import { Node, mergeAttributes, type NodeConfig } from "@tiptap/core"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react"
import { EmbedCard, type EmbedKind } from "@/features/notes/EmbedCard"

const DIRECTIVE = /^\[\[\s*(tip|question|material)\s*:\s*([A-Za-z0-9_-]+)\s*(?:\|\s*([a-z]+)\s*)?\]\]/i

function EmbedNodeView({ node }: ReactNodeViewProps) {
  const kind = ((node.attrs.kind as string) || "tip") as EmbedKind
  return (
    <NodeViewWrapper className="note-embed-node">
      <div contentEditable={false}>
        <EmbedCard kind={kind} id={(node.attrs.id as string) || ""} style={(node.attrs.style as string) || undefined} />
      </div>
    </NodeViewWrapper>
  )
}

/**
 * 块级嵌入节点：[[tip:id|style]] / [[question:id]] / [[material:id]]
 * - 自定义 markdown 分词器 + 渲染：Markdown 往返不丢
 * - appendTransaction：把「整段就是一条指令」的段落自动转成节点（输入/粘贴/加载）
 */
const config = {
  name: "noteEmbed",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      kind: { default: "tip" },
      id: { default: "" },
      style: { default: null },
    }
  },
  parseHTML() {
    return [{ tag: "div[data-note-embed]" }]
  },
  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-note-embed": "" })]
  },
  parseMarkdown: (token: Record<string, unknown>) => ({
    type: "noteEmbed",
    attrs: {
      kind: token.kind,
      id: token.id,
      style: (token.style as string) || null,
    },
  }),
  renderMarkdown: (node: { attrs?: Record<string, unknown> }) => {
    const attrs = node.attrs || {}
    const style = attrs.style ? `|${attrs.style}` : ""
    return `[[${attrs.kind}:${attrs.id}${style}]]`
  },
  markdownTokenizer: {
    name: "noteEmbed",
    level: "block",
    start: (src: string) => src.indexOf("[["),
    tokenize: (src: string) => {
      const m = src.match(DIRECTIVE)
      if (!m) return undefined
      return {
        type: "noteEmbed",
        raw: m[0],
        kind: m[1].toLowerCase(),
        id: m[2],
        style: m[3] || undefined,
      }
    },
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("noteEmbedAuto"),
        appendTransaction: (_transactions, _oldState, newState) => {
          const type = newState.schema.nodes.noteEmbed
          if (!type) return null
          const matches: Array<{ from: number; to: number; attrs: Record<string, unknown> }> = []
          newState.doc.descendants((node, pos) => {
            if (!node.isTextblock) return
            const m = node.textContent.trim().match(new RegExp(`^${DIRECTIVE.source}$`, "i"))
            if (!m) return
            matches.push({
              from: pos,
              to: pos + node.nodeSize,
              attrs: { kind: m[1].toLowerCase(), id: m[2], style: m[3] || null },
            })
          })
          if (matches.length === 0) return null
          matches.sort((a, b) => b.from - a.from)
          let tr = newState.tr
          for (const mt of matches) {
            tr = tr.replaceWith(mt.from, mt.to, type.create(mt.attrs))
          }
          return tr
        },
      }),
    ]
  },
  addNodeView() {
    return ReactNodeViewRenderer(EmbedNodeView)
  },
}

export const NoteEmbed = Node.create(config as unknown as NodeConfig)
