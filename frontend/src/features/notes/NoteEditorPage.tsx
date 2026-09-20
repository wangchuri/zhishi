import { useEffect, useRef, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Eye, Loader2, Pencil, PanelRight, PanelRightClose, Save } from "lucide-react"
import { toast } from "sonner"
import { AppShell } from "@/components/layout/AppShell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Editor } from "@tiptap/react"
import { NoteContent } from "@/features/notes/NoteContent"
import { NoteSidebar } from "@/features/notes/NoteSidebar"
import { RichNoteEditor } from "@/features/notes/RichNoteEditor"
import { kbApi, notesApi } from "@/lib/api"
import { cn } from "@/lib/utils"

interface DocOption {
  id: string
  name: string
}

export function NoteEditorPage() {
  const { noteId } = useParams()
  const navigate = useNavigate()
  const editing = Boolean(noteId)

  const [loading, setLoading] = useState(editing)
  const [missing, setMissing] = useState(false)
  const [saving, setSaving] = useState(false)

  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [folder, setFolder] = useState("我的笔记")
  const [documentId, setDocumentId] = useState("")
  const [preview, setPreview] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const [folders, setFolders] = useState<string[]>([])
  const [docs, setDocs] = useState<DocOption[]>([])
  const editorRef = useRef<Editor | null>(null)

  const insertEmbed = (raw: string) => {
    setPreview(false)
    const m = raw.match(
      /\[\[\s*(tip|question|material)\s*:\s*([A-Za-z0-9_-]+)\s*(?:\|\s*([a-z]+)\s*)?\]\]/i,
    )
    const editor = editorRef.current
    if (editor && m) {
      editor
        .chain()
        .focus()
        .insertContent([
          { type: "noteEmbed", attrs: { kind: m[1].toLowerCase(), id: m[2], style: m[3] || null } },
        ])
        .run()
      return
    }
    setContent((prev) => (prev ? `${prev}\n${raw}` : raw))
  }

  useEffect(() => {
    notesApi
      .listFolders()
      .then((r) => {
        const names = (r.folders || []).map((f) => f.name).filter((n) => n && n !== "tip")
        setFolders(names)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    kbApi
      .listCollections()
      .then(async (res) => {
        const cols = ((res.collections || []) as Array<{ id: string; zone?: string }>).filter(
          (c) => c.zone === "study",
        )
        const lists = await Promise.all(
          cols.map((c) => kbApi.listDocuments(1, 100, c.id).catch(() => ({ documents: [] }))),
        )
        if (cancelled) return
        const all: DocOption[] = []
        const seen = new Set<string>()
        for (const list of lists) {
          for (const d of (list.documents || []) as Array<Record<string, unknown>>) {
            const id = String(d.id || "")
            if (!id || seen.has(id)) continue
            seen.add(id)
            all.push({ id, name: String(d.display_name || d.name || "未命名资料") })
          }
        }
        setDocs(all)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!editing || !noteId) return
    let cancelled = false
    setLoading(true)
    notesApi
      .get(noteId)
      .then((n) => {
        if (cancelled) return
        setTitle(n.title || "")
        setContent(n.content_md || "")
        setFolder(n.folder || "我的笔记")
        setDocumentId(n.document_id || "")
      })
      .catch(() => {
        if (!cancelled) setMissing(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [editing, noteId])

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      const payload = {
        title: title.trim() || "无标题",
        content_md: content,
        folder: folder.trim() || "我的笔记",
        document_id: documentId || null,
      }
      const note =
        editing && noteId ? await notesApi.update(noteId, payload) : await notesApi.create(payload)
      toast.success(editing ? "已保存" : "已新建笔记")
      navigate(`/notes/${note.id}`, { replace: true })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  if (missing) {
    return (
      <AppShell maxWidth={880}>
        <div className="rounded-2xl border border-line bg-paper p-8 text-center text-ink-soft">
          找不到这条笔记。
          <div className="mt-3">
            <Link to="/notes" className="text-sea hover:underline">
              回笔记页
            </Link>
          </div>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell maxWidth={1240}>
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1 text-small text-ink-soft hover:text-sea"
        >
          <ArrowLeft className="w-4 h-4" strokeWidth={2} />
          返回
        </button>
        <span className="text-caption text-ink-disabled">{editing ? "编辑笔记" : "新建笔记"}</span>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => setSidebarOpen((v) => !v)}>
          {sidebarOpen ? (
            <PanelRightClose className="w-4 h-4" />
          ) : (
            <PanelRight className="w-4 h-4" />
          )}
          {sidebarOpen ? "收起侧栏" : "侧栏"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setPreview((v) => !v)}>
          {preview ? <Pencil className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          {preview ? "继续编辑" : "预览"}
        </Button>
        <Button variant="primary" size="sm" onClick={() => void save()} disabled={saving || loading}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          保存
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-ink-disabled gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          打开笔记…
        </div>
      ) : (
        <div
          className={cn(
            "grid grid-cols-1 gap-5 items-start",
            sidebarOpen && "lg:grid-cols-[minmax(0,1fr)_320px]",
          )}
        >
        <article className="rounded-2xl border border-line bg-paper p-5 md:p-7">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="标题"
            className="w-full bg-transparent font-display text-[1.6rem] leading-snug text-ink placeholder:text-ink-disabled focus:outline-none mb-3"
          />

          <div className="flex flex-wrap items-center gap-2 mb-5">
            <Input
              list="note-folder-options"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="文件夹"
              className="h-9 w-40 text-small"
            />
            <datalist id="note-folder-options">
              {folders.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>

            <Select
              value={documentId || "none"}
              onValueChange={(v) => setDocumentId(v === "none" ? "" : v)}
            >
              <SelectTrigger size="sm" className="w-56 text-small">
                <SelectValue placeholder="关联资料（可选）" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">不关联资料</SelectItem>
                {docs.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {preview ? (
            <div className={cn("min-h-[50vh] rounded-md border border-line-light bg-paper-2/40 p-4")}>
              {content.trim() ? (
                <NoteContent content={content} />
              ) : (
                <p className="text-caption text-ink-disabled">还没有内容。</p>
              )}
            </div>
          ) : (
            <RichNoteEditor
              value={content}
              onChange={setContent}
              onReady={(ed) => {
                editorRef.current = ed
              }}
            />
          )}
        </article>
        {sidebarOpen ? <NoteSidebar documentId={documentId} onInsert={insertEmbed} /> : null}
        </div>
      )}
    </AppShell>
  )
}
