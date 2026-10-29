"use client"

import { useEffect, useRef, useState } from "react"
import { Download, FileQuestion, Loader2, Pencil, Save } from "lucide-react"
import { toast } from "sonner"

import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "avif",
])

// never text, so there is no pen for them (anything else is checked by the backend)
const BINARY_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  "jar",
  "zip",
  "gz",
  "tgz",
  "tar",
  "7z",
  "rar",
  "mca",
  "mcr",
  "mcc",
  "dat",
  "dat_old",
  "nbt",
  "lock",
  "class",
  "exe",
  "dll",
  "so",
  "dylib",
  "db",
  "sqlite",
  "mp3",
  "ogg",
  "wav",
  "mp4",
  "pdf",
  "ttf",
  "otf",
  "woff",
  "woff2",
])

const extension = (name: string) =>
  name.includes(".") ? name.split(".").pop()!.toLowerCase() : ""

export const isImageFile = (name: string) =>
  IMAGE_EXTENSIONS.has(extension(name))

export const isEditableFile = (name: string) =>
  !BINARY_EXTENSIONS.has(extension(name))

type View =
  | { kind: "loading" }
  | { kind: "image"; url: string }
  | { kind: "text" }
  | { kind: "binary"; reason: string }

interface Props {
  serverId: number
  /** the open file, or null when closed */
  file: { path: string; name: string; edit: boolean } | null
  onClose: () => void
  onSaved?: () => void
}

// Preview of a server file: images are shown, text files are shown and can be
// edited and saved, anything else offers a download.
export function FileViewer({ serverId, file, onClose, onSaved }: Props) {
  const [view, setView] = useState<View>({ kind: "loading" })
  const [original, setOriginal] = useState("")
  const [text, setText] = useState("")
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  // textareas turn \r\n into \n; put Windows line endings back on save
  const [crlf, setCrlf] = useState(false)
  const editorRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!file) return
    let cancelled = false
    let objectUrl: string | null = null
    // a new file remounts this component (see its key), so the state
    // starts out as "loading"
    const load = isImageFile(file.name)
      ? api.files.blob(serverId, file.path).then((blob) => {
          objectUrl = URL.createObjectURL(blob)
          if (!cancelled) setView({ kind: "image", url: objectUrl })
        })
      : api.files.content(serverId, file.path).then((res) => {
          if (cancelled) return
          if (!res.editable) {
            setView({
              kind: "binary",
              reason: res.reason ?? "This file can't be shown.",
            })
            return
          }
          const content = res.content ?? ""
          setCrlf(content.includes("\r\n"))
          setOriginal(content.replace(/\r\n/g, "\n"))
          setText(content.replace(/\r\n/g, "\n"))
          setView({ kind: "text" })
          setEditing(file.edit)
        })
    load.catch((err) => {
      if (!cancelled)
        setView({
          kind: "binary",
          reason: err instanceof Error ? err.message : "Could not open file",
        })
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [serverId, file])

  useEffect(() => {
    if (editing) editorRef.current?.focus()
  }, [editing])

  const dirty = editing && text !== original

  function close() {
    if (dirty && !window.confirm("Discard your unsaved changes?")) return
    onClose()
  }

  async function save() {
    if (!file || saving) return
    setSaving(true)
    try {
      await api.files.save(
        serverId,
        file.path,
        crlf ? text.replace(/\n/g, "\r\n") : text
      )
      setOriginal(text)
      toast.success(`${file.name} saved`)
      onSaved?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save")
    } finally {
      setSaving(false)
    }
  }

  function download() {
    if (!file) return
    api.files
      .download(api.files.downloadUrl(serverId, file.path), file.name)
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : "Download failed")
      )
  }

  function onEditorKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault()
      save()
    } else if (e.key === "Tab" && !e.shiftKey) {
      // indent instead of leaving the editor (spaces: YAML forbids tabs)
      e.preventDefault()
      const el = e.currentTarget
      const { selectionStart: start, selectionEnd: end } = el
      setText(text.slice(0, start) + "  " + text.slice(end))
      requestAnimationFrame(() => el.setSelectionRange(start + 2, start + 2))
    }
  }

  return (
    <Dialog open={file !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="flex h-[85vh] flex-col gap-3 sm:max-w-4xl">
        <DialogHeader className="pr-8">
          <DialogTitle className="truncate font-mono text-sm">
            {file?.path}
            {dirty && <span className="text-muted-foreground"> •</span>}
          </DialogTitle>
          <DialogDescription>
            {view.kind === "text" &&
              (editing
                ? "Editing. Save with the button or Ctrl+S / ⌘S."
                : "Preview")}
            {view.kind === "image" && "Image preview"}
            {view.kind === "binary" && "No preview"}
            {view.kind === "loading" && "Loading…"}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-muted/30">
          {view.kind === "loading" && (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {view.kind === "image" && (
            <div className="flex h-full items-center justify-center overflow-auto bg-[conic-gradient(var(--muted)_25%,transparent_0_50%,var(--muted)_0_75%,transparent_0)] bg-[length:16px_16px] p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={view.url}
                alt={file?.name}
                className="max-h-full max-w-full object-contain [image-rendering:pixelated]"
              />
            </div>
          )}
          {view.kind === "text" &&
            (editing ? (
              <textarea
                ref={editorRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onEditorKey}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                className="h-full w-full resize-none bg-transparent p-3 font-mono text-xs leading-relaxed outline-none"
              />
            ) : (
              <pre className="h-full overflow-auto p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                {text || (
                  <span className="text-muted-foreground">Empty file</span>
                )}
              </pre>
            ))}
          {view.kind === "binary" && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <FileQuestion className="size-8" />
              {view.reason}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={download}>
            <Download className="size-3.5" />
            Download
          </Button>
          <div className="flex gap-2">
            {view.kind === "text" && editing && (
              <Button
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => {
                  if (dirty && !window.confirm("Discard your unsaved changes?"))
                    return
                  setText(original)
                  setEditing(false)
                }}
              >
                Cancel
              </Button>
            )}
            {view.kind === "text" && !editing && (
              <Button size="sm" onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" />
                Edit
              </Button>
            )}
            {view.kind === "text" && editing && (
              <Button size="sm" disabled={saving || !dirty} onClick={save}>
                {saving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                Save
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
