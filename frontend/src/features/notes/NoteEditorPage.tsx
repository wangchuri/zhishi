import { useCallback, useEffect, useRef, useState } from "react"
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

function payloadKey(title: string, content: string, folder: string, documentId: string): string {
  return JSON.stringify([title.trim(), content, folder.trim(), documentId])
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
  const [currentNoteId, setCurrentNoteId] = useState<string | null>(noteId ?? null)
  const [autoSaving, setAutoSaving] = useState(false)
  const [autoSavedAt, setAutoSavedAt] = useState<string | null>(null)
  const editorRef = useRef<Editor | null>(null)

  const stateRef = useRef({ title, content, folder, documentId })
  stateRef.current = { title, content, folder, documentId }
  const currentNoteIdRef = useRef<string | null>(noteId ?? null)
  const lastSavedRef = useRef("")
  const draftTimer = useRef<number | null>(null)
  const inFlightRef = useRef(false)

  const runAutosave = useCallback(async () => {
    const s = stateRef.current
    if (!s.title.trim() && !s.content.trim()) return
    const key = payloadKey(s.title, s.content, s.folder, s.documentId)
    if (key === lastSavedRef.current || inFlightRef.current) return
    inFlightRef.current = true
    setAutoSaving(true)
    try {
      const body = {
        title: s.title.trim() || "无标题",
        content_md: s.content,
        folder: s.folder.trim() || "我的笔记",
        document_id: s.documentId || null,
      }
      if (currentNoteIdRef.current) {
        await notesApi.update(currentNoteIdRef.current, body)
      } else {
        const note = await notesApi.create({ ...body, is_draft: true })
        currentNoteIdRef.current = note.id
        setCurrentNoteId(note.id)
        window.history.replaceState(null, "", `/notes/${note.id}/edit`)
      }
      lastSavedRef.current = key
      setAutoSavedAt(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }))
    } catch {
      /* 自动保存失败静默处理，手动保存时再提示 */
    } finally {
      inFlightRef.current = false
      setAutoSaving(false)
    }
  }, [])

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
        const loadedTitle = n.title || ""
        const loadedContent = n.content_md || ""
        const loadedFolder = n.folder || "我的笔记"
        const loadedDoc = n.document_id || ""
        setTitle(loadedTitle)
        setContent(loadedContent)
        setFolder(loadedFolder)
        setDocumentId(loadedDoc)
        currentNoteIdRef.current = n.id
        setCurrentNoteId(n.id)
        lastSavedRef.current = payloadKey(loadedTitle, loadedContent, loadedFolder, loadedDoc)
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

  useEffect(() => {
    if (loading) return
    const s = stateRef.current
    if (!s.title.trim() && !s.content.trim()) return
    if (payloadKey(s.title, s.content, s.folder, s.documentId) === lastSavedRef.current) return
    if (draftTimer.current) window.clearTimeout(draftTimer.current)
    draftTimer.current = window.setTimeout(() => {
      void runAutosave()
    }, 1500)
    return () => {
      if (draftTimer.current) window.clearTimeout(draftTimer.current)
    }
  }, [title, content, folder, documentId, loading, runAutosave])

  useEffect(() => {
    const flush = () => {
      void runAutosave()
    }
    const onHide = () => {
      if (document.visibilityState === "hidden") flush()
    }
    window.addEventListener("beforeunload", flush)
    document.addEventListener("visibilitychange", onHide)
    return () => {
      window.removeEventListener("beforeunload", flush)
      document.removeEventListener("visibilitychange", onHide)
      if (draftTimer.current) window.clearTimeout(draftTimer.current)
      flush()
    }
  }, [runAutosave])

  const registerFolder = async () => {
    const name = folder.trim()
    if (!name || folders.includes(name)) return
    try {
      await notesApi.createFolder(name)
      setFolders((prev) => (prev.includes(name) ? prev : [...prev, name]))
    } catch {
      /* 忽略：保存笔记时后端也会自动登记文件夹 */
    }
  }

  const save = async () => {
    if (saving) return
    if (!title.trim() && !content.trim()) {
      toast.error("先写点内容再保存吧")
      return
    }
    setSaving(true)
    try {
      const body = {
        title: title.trim() || "无标题",
        content_md: content,
        folder: folder.trim() || "我的笔记",
        document_id: documentId || null,
        is_draft: false,
      }
      if (draftTimer.current) window.clearTimeout(draftTimer.current)
      const id = currentNoteIdRef.current
      const note = id ? await notesApi.update(id, body) : await notesApi.create(body)
      lastSavedRef.current = payloadKey(title, content, folder, documentId)
      currentNoteIdRef.current = note.id
      setCurrentNoteId(note.id)
      toast.success(editing || id ? "已保存" : "已新建笔记")
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
        <span className="hidden sm:inline-flex items-center gap-1 text-caption text-ink-disabled">
          {autoSaving ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              自动保存中…
            </>
          ) : autoSavedAt ? (
            `草稿已自动保存 ${autoSavedAt}`
          ) : currentNoteId && !editing ? (
            "草稿会自动保存"
          ) : null}
        </span>
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
              onBlur={() => void registerFolder()}
              placeholder="文件夹（可新建）"
              className="h-9 w-44 text-small"
            />
            <datalist id="note-folder-options">
              {Array.from(new Set(["我的笔记", ...folders, folder.trim()].filter(Boolean))).map(
                (name) => (
                  <option key={name} value={name} />
                ),
              )}
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
