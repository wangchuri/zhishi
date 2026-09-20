import { useEffect, useReducer, useRef } from "react"
import { EditorContent, useEditor, type Editor } from "@tiptap/react"
import { StarterKit } from "@tiptap/starter-kit"
import { Markdown } from "@tiptap/markdown"
import { Mathematics, migrateMathStrings } from "@tiptap/extension-mathematics"
import {
  Bold,
  Code2,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Undo2,
} from "lucide-react"
import { NoteEmbed } from "@/features/notes/noteEmbed"
import { cn } from "@/lib/utils"

function ToolbarButton({
  title,
  active,
  disabled,
  onClick,
  children,
}: {
  title: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-8 w-8 grid place-items-center rounded-md text-ink-soft transition-colors disabled:opacity-40",
        active ? "bg-sea-subtle text-sea" : "hover:bg-sea-subtle hover:text-sea",
      )}
    >
      {children}
    </button>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  return (
    <div className="flex items-center gap-0.5 flex-wrap border-b border-line-light px-2 py-1">
      <ToolbarButton
        title="撤销"
        disabled={!editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <Undo2 className="w-4 h-4" strokeWidth={2} />
      </ToolbarButton>
      <ToolbarButton
        title="重做"
        disabled={!editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <Redo2 className="w-4 h-4" strokeWidth={2} />
      </ToolbarButton>
      <span className="w-px h-5 bg-line mx-1" />
      <ToolbarButton
        title="二级标题"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 className="w-4 h-4" strokeWidth={2} />
      </ToolbarButton>
      <ToolbarButton
        title="三级标题"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 className="w-4 h-4" strokeWidth={2} />
      </ToolbarButton>
      <ToolbarButton
        title="加粗"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="w-4 h-4" strokeWidth={2.4} />
      </ToolbarButton>
      <ToolbarButton
        title="斜体"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="w-4 h-4" strokeWidth={2} />
      </ToolbarButton>
      <ToolbarButton
        title="无序列表"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="w-4 h-4" strokeWidth={2} />
      </ToolbarButton>
      <ToolbarButton
        title="有序列表"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="w-4 h-4" strokeWidth={2} />
      </ToolbarButton>
      <ToolbarButton
        title="引用"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote className="w-4 h-4" strokeWidth={2} />
      </ToolbarButton>
      <ToolbarButton
        title="代码块"
        active={editor.isActive("codeBlock")}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <Code2 className="w-4 h-4" strokeWidth={2} />
      </ToolbarButton>
    </div>
  )
}

interface RichNoteEditorProps {
  value: string
  onChange: (markdown: string) => void
  onReady?: (editor: Editor | null) => void
}

export function RichNoteEditor({ value, onChange, onReady }: RichNoteEditorProps) {
  const onChangeRef = useRef(onChange)
  const onReadyRef = useRef(onReady)
  const lastEmitted = useRef<string | null>(null)
  const [, bump] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])
  useEffect(() => {
    onReadyRef.current = onReady
  }, [onReady])

  const editor = useEditor({
    extensions: [StarterKit, Markdown, Mathematics, NoteEmbed],
    content: "",
    editorProps: {
      attributes: { class: "zhishi-editor focus:outline-none" },
    },
    onUpdate: ({ editor: ed }) => {
      const md = ed.getMarkdown()
      lastEmitted.current = md
      onChangeRef.current(md)
    },
  })

  useEffect(() => {
    onReadyRef.current?.(editor)
    return () => onReadyRef.current?.(null)
  }, [editor])

  // 外部内容变化（加载笔记 / 侧栏插入）时灌入编辑器；自身输入不回灌
  useEffect(() => {
    if (!editor) return
    if (value === lastEmitted.current) return
    editor.commands.setContent(value || "", { contentType: "markdown" })
    migrateMathStrings(editor)
    lastEmitted.current = value
  }, [editor, value])

  useEffect(() => {
    if (!editor) return
    const refresh = () => bump()
    editor.on("transaction", refresh)
    editor.on("selectionUpdate", refresh)
    return () => {
      editor.off("transaction", refresh)
      editor.off("selectionUpdate", refresh)
    }
  }, [editor])

  if (!editor) return null

  return (
    <div className="rounded-md border border-line-light bg-paper-2/40 overflow-hidden">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} className="px-3 py-2 min-h-[50vh]" />
    </div>
  )
}
