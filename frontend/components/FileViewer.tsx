"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import {
  Braces,
  Download,
  FileQuestion,
  Loader2,
  Pencil,
  Save,
} from "lucide-react"
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

// CodeMirror is big and browser-only, so it loads when a file is opened
const CodeEditor = dynamic(() => import("@/components/CodeEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  ),
})

const LANGUAGE_NAMES: Record<string, string> = {
  json: "JSON",
  json5: "JSON",
  jsonc: "JSON",
  mcmeta: "JSON",
  yml: "YAML",
  yaml: "YAML",
  properties: "Properties",
  cfg: "Config",
  conf: "Config",
  ini: "INI",
  toml: "TOML",
  js: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  ts: "TypeScript",
  xml: "XML",
  html: "HTML",
  css: "CSS",
  md: "Markdown",
  sh: "Shell",
  bash: "Shell",
  py: "Python",
  lua: "Lua",
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin",
  log: "Log",
  txt: "Text",
}

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
  // the editor's Ctrl+S calls the latest save() without being rebuilt
  const saveRef = useRef<() => void>(() => {})
  const saveShortcut = useCallback(() => saveRef.current(), [])

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

  useEffect(() => {
    saveRef.current = save
  })

  const ext = file ? extension(file.name) : ""
  const languageName = LANGUAGE_NAMES[ext] ?? null
  const isJson = LANGUAGE_NAMES[ext] === "JSON" && ext !== "json5"

  // pretty-print JSON with two-space indentation
  function formatJson() {
    try {
      setText(JSON.stringify(JSON.parse(text), null, 2) + "\n")
    } catch (err) {
      toast.error(
        `Can't format: ${err instanceof Error ? err.message : "invalid JSON"}`
      )
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
              `${languageName ? `${languageName} · ` : ""}${
                editing
                  ? "Editing. Save with the button or Ctrl+S / ⌘S."
                  : "Preview"
              }`}
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
          {view.kind === "text" && file && (
            <CodeEditor
              key={editing ? "edit" : "view"}
              name={file.name}
              value={text}
              onChange={editing ? setText : undefined}
              readOnly={!editing}
              onSave={editing ? saveShortcut : undefined}
              autoFocus={editing}
            />
          )}
          {view.kind === "binary" && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <FileQuestion className="size-8" />
              {view.reason}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={download}>
              <Download className="size-3.5" />
              Download
            </Button>
            {view.kind === "text" && editing && isJson && (
              <Button
                variant="ghost"
                size="sm"
                onClick={formatJson}
                title="Pretty-print with two-space indentation"
              >
                <Braces className="size-3.5" />
                Format
              </Button>
            )}
          </div>
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
