"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import {
  Folder,
  File,
  ChevronRight,
  Upload,
  Trash2,
  Download,
  MoreHorizontal,
  Loader2,
  Home,
  Pencil,
  Image as ImageIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import type { FileEntry, UploadProgressInfo } from "@/lib/types"
import { api } from "@/lib/api"
import {
  FileUploadProgress,
  type FileUploadItem,
} from "@/components/FileUploadProgress"
import {
  FileViewer,
  isEditableFile,
  isImageFile,
} from "@/components/FileViewer"

// LocalEntry extends FileEntry with an optional `pending` flag for optimistic UI
type LocalEntry = FileEntry & { pending?: boolean }

interface Props {
  serverId: number
}

interface MenuState {
  name: string
  entryPath: string
  isFile: boolean
  x: number
  y: number
}

function formatSize(bytes: number | null) {
  if (bytes === null) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FileExplorer({ serverId }: Props) {
  const [path, setPath] = useState("/")
  const [entries, setEntries] = useState<LocalEntry[]>([])
  const [loading, setLoading] = useState(true)
  // names to delete after confirming (one from a menu, or the selection)
  const [deleteTargets, setDeleteTargets] = useState<string[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const lastClicked = useRef<number | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploads, setUploads] = useState<FileUploadItem[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [opened, setOpened] = useState<{
    path: string
    name: string
    edit: boolean
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const dismissUploadsRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear any pending auto-dismiss timer on unmount
  useEffect(() => {
    return () => {
      if (dismissUploadsRef.current) clearTimeout(dismissUploadsRef.current)
    }
  }, [])

  // Close menu on scroll or click outside
  useEffect(() => {
    if (!menu) return
    function close() {
      setMenu(null)
    }
    window.addEventListener("scroll", close, true)
    window.addEventListener("mousedown", close)
    return () => {
      window.removeEventListener("scroll", close, true)
      window.removeEventListener("mousedown", close)
    }
  }, [menu])

  const loadDir = useCallback(
    async (targetPath: string) => {
      setLoading(true)
      try {
        const res = await api.files.list(serverId, targetPath)
        setEntries(res?.entries ?? [])
        setPath(res?.path ?? targetPath)
        setSelected(new Set())
        lastClicked.current = null
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to load directory"
        )
      } finally {
        setLoading(false)
      }
    },
    [serverId]
  )

  useEffect(() => {
    loadDir(path)
  }, []) // only on mount; navigate via loadDir calls

  // Breadcrumb segments
  const segments = path === "/" ? [] : path.replace(/^\//, "").split("/")

  function navigateTo(index: number) {
    if (index < 0) {
      loadDir("/")
    } else {
      loadDir("/" + segments.slice(0, index + 1).join("/"))
    }
    setMenu(null)
  }

  function handleEntryClick(entry: FileEntry, edit = false) {
    const next = path === "/" ? `/${entry.name}` : `${path}/${entry.name}`
    if (entry.type === "directory") loadDir(next)
    else setOpened({ path: next, name: entry.name, edit })
  }

  const pathOf = (name: string) =>
    path === "/" ? `/${name}` : `${path}/${name}`

  async function handleDelete() {
    if (!deleteTargets?.length) return
    const names = deleteTargets
    setDeleting(true)

    // Optimistically remove the entries right away
    const removed = entries.filter((e) => names.includes(e.name))
    setEntries((prev) => prev.filter((e) => !names.includes(e.name)))
    setSelected(new Set())
    setDeleteTargets(null)

    const results = await Promise.allSettled(
      names.map((name) => api.files.delete(serverId, pathOf(name)))
    )
    const failed = names.filter((_, i) => results[i].status === "rejected")
    // put back what could not be deleted
    if (failed.length)
      setEntries((prev) => [
        ...prev,
        ...removed.filter((e) => failed.includes(e.name)),
      ])
    const done = names.length - failed.length
    if (failed.length) {
      const first = results.find((r) => r.status === "rejected") as
        | PromiseRejectedResult
        | undefined
      const reason =
        first?.reason instanceof Error ? first.reason.message : "Delete failed"
      toast.error(
        names.length === 1
          ? reason
          : `${failed.length} of ${names.length} could not be deleted (${failed.join(", ")}): ${reason}`
      )
    }
    if (done)
      toast.success(
        names.length === 1
          ? `"${names[0]}" deleted`
          : `${done} item${done === 1 ? "" : "s"} deleted`
      )
    setDeleting(false)
  }

  // fetched with the login token, which a plain link can't send
  function download(url: string, filename: string, message: string) {
    setMenu(null)
    const id = toast.loading(message)
    api.files
      .download(url, filename)
      .then(() => toast.dismiss(id))
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : "Download failed", {
          id,
        })
      )
  }

  function handleDownload(name: string) {
    const filePath = path === "/" ? `/${name}` : `${path}/${name}`
    download(
      api.files.downloadUrl(serverId, filePath),
      name,
      `Downloading "${name}"…`
    )
  }

  function handleDownloadFolder(name: string) {
    const folderPath = path === "/" ? `/${name}` : `${path}/${name}`
    download(
      api.files.downloadFolderUrl(serverId, folderPath),
      `${name}.zip`,
      `Preparing zip for "${name}"…`
    )
  }

  async function uploadFiles(files: FileList | File[]) {
    const fileArr = Array.from(files)
    if (fileArr.length === 0) return
    setUploading(true)
    if (dismissUploadsRef.current) clearTimeout(dismissUploadsRef.current)

    // Optimistically add ghost entries so the user sees them immediately
    const placeholders: LocalEntry[] = fileArr.map((f) => ({
      name: f.name,
      type: "file",
      size: f.size,
      pending: true,
    }))
    setEntries((prev) => [...prev, ...placeholders])

    // Map each File back to its progress-panel row id — File objects are
    // reference-stable, so this survives the round trip through api.files.upload.
    const idFor = new Map<File, string>()
    const items: FileUploadItem[] = fileArr.map((f, i) => {
      const id = `${Date.now()}-${i}-${f.name}`
      idFor.set(f, id)
      return { id, name: f.name, loaded: 0, total: f.size, status: "uploading" }
    })
    setUploads(items)

    const label =
      fileArr.length === 1 ? `"${fileArr[0].name}"` : `${fileArr.length} files`

    function onProgress(file: File, info: UploadProgressInfo) {
      const id = idFor.get(file)
      if (!id) return
      setUploads((prev) =>
        prev.map((u) =>
          u.id === id
            ? {
                ...u,
                loaded: info.loaded,
                status: info.status,
                error: info.error,
              }
            : u
        )
      )
    }

    try {
      const res = await api.files.upload(
        serverId,
        fileArr,
        path,
        undefined,
        onProgress
      )
      toast.success(res?.message ?? `Uploaded ${label}`)
      loadDir(path) // Replace placeholders with real server data
      dismissUploadsRef.current = setTimeout(() => setUploads([]), 2500)
    } catch (err) {
      // Remove ghost entries on failure — the per-file progress panel stays
      // open (showing which ones failed) until the user dismisses it.
      setEntries((prev) => prev.filter((e) => !e.pending))
      toast.error(
        `Failed to upload ${label}: ${err instanceof Error ? err.message : "Unknown error"}`
      )
    } finally {
      setUploading(false)
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) uploadFiles(e.target.files)
    e.target.value = ""
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    if (e.dataTransfer.files) uploadFiles(e.dataTransfer.files)
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    // Only clear when leaving the drop zone entirely, not child elements
    if (!dropZoneRef.current?.contains(e.relatedTarget as Node)) {
      setDragOver(false)
    }
  }

  const sorted = [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  const selectable = sorted.filter((e) => !e.pending)
  const allSelected =
    selectable.length > 0 && selectable.every((e) => selected.has(e.name))

  // click toggles one; shift-click selects the range from the last click
  function toggleSelected(index: number, shift: boolean) {
    const name = sorted[index].name
    const next = new Set(selected)
    if (shift && lastClicked.current !== null) {
      const [from, to] = [lastClicked.current, index].sort((a, b) => a - b)
      const on = !selected.has(name)
      for (const e of sorted.slice(from, to + 1))
        if (!e.pending) {
          if (on) next.add(e.name)
          else next.delete(e.name)
        }
    } else if (next.has(name)) next.delete(name)
    else next.add(name)
    lastClicked.current = index
    setSelected(next)
  }

  const deleteNames = deleteTargets ?? []
  const deleteFolders = entries.filter(
    (e) => deleteNames.includes(e.name) && e.type === "directory"
  ).length

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        {/* Breadcrumb */}
        <nav
          aria-label="File path"
          className="flex min-w-0 items-center gap-1 text-xs"
        >
          <button
            onClick={() => navigateTo(-1)}
            className="flex items-center gap-0.5 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Go to root"
          >
            <Home className="size-3" />
          </button>
          {segments.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
              <button
                onClick={() => navigateTo(i)}
                className="max-w-24 truncate text-muted-foreground transition-colors hover:text-foreground"
              >
                {seg}
              </button>
            </span>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Upload file"
          >
            {uploading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Upload className="size-3.5" />
            )}
            Upload
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileInput}
          />
        </div>
      </div>

      {/* Selection bar */}
      {!loading && selectable.length > 0 && (
        <div className="flex h-9 items-center gap-3 border-b border-border px-4 text-xs">
          <input
            type="checkbox"
            className="size-3.5 cursor-pointer accent-primary"
            aria-label={allSelected ? "Select none" : "Select all"}
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = selected.size > 0 && !allSelected
            }}
            onChange={() =>
              setSelected(
                allSelected ? new Set() : new Set(selectable.map((e) => e.name))
              )
            }
          />
          {selected.size > 0 ? (
            <>
              <span className="font-medium">{selected.size} selected</span>
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </button>
              <Button
                size="sm"
                variant="destructive"
                className="ml-auto h-7"
                disabled={deleting}
                onClick={() => setDeleteTargets([...selected])}
              >
                <Trash2 className="size-3.5" />
                Delete {selected.size}
              </Button>
            </>
          ) : (
            <span className="text-muted-foreground">
              Select all · Shift-click to select a range
            </span>
          )}
        </div>
      )}

      {/* File list drop zone */}
      <div
        ref={dropZoneRef}
        className={`flex-1 overflow-y-auto transition-colors ${dragOver ? "bg-primary/5 ring-2 ring-primary/30 ring-inset" : ""}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : entries.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            Empty directory
          </div>
        ) : (
          <ul>
            {sorted.map((entry, index) => {
              const entryPath = pathOf(entry.name)
              const isSelected = selected.has(entry.name)

              return (
                <li
                  key={entry.pending ? `pending-${entry.name}` : entry.name}
                  className={`group flex items-center gap-3 px-4 py-2 transition-colors hover:bg-muted/60 ${entry.pending ? "opacity-50" : ""} ${isSelected ? "bg-primary/10" : ""}`}
                >
                  {/* Select — always visible once something is selected */}
                  <input
                    type="checkbox"
                    className={`size-3.5 shrink-0 cursor-pointer accent-primary transition-opacity ${
                      selected.size > 0
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    }`}
                    disabled={!!entry.pending}
                    checked={isSelected}
                    aria-label={`Select ${entry.name}`}
                    onChange={() => {}}
                    onClick={(e) => toggleSelected(index, e.shiftKey)}
                  />
                  {/* Icon + name */}
                  <button
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    disabled={!!entry.pending}
                    onClick={() => handleEntryClick(entry)}
                    aria-label={`${entry.type === "directory" ? "Open folder" : "Preview"}: ${entry.name}`}
                  >
                    {entry.pending ? (
                      <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                    ) : entry.type === "directory" ? (
                      <Folder className="size-4 shrink-0 text-primary" />
                    ) : isImageFile(entry.name) ? (
                      <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <File className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span
                      className={`truncate text-sm ${entry.pending ? "text-muted-foreground italic" : ""}`}
                    >
                      {entry.name}
                    </span>
                  </button>

                  {/* Size */}
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatSize(entry.size)}
                  </span>

                  {/* Edit — text files only, shown on hover */}
                  {!entry.pending &&
                  entry.type === "file" &&
                  isEditableFile(entry.name) ? (
                    <button
                      className="flex size-6 items-center justify-center opacity-0 transition-all group-hover:opacity-100 hover:bg-muted focus-visible:opacity-100"
                      onClick={() => handleEntryClick(entry, true)}
                      aria-label={`Edit ${entry.name}`}
                      title="Edit"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  ) : (
                    <span className="size-6 shrink-0" aria-hidden />
                  )}

                  {/* Three-dot trigger — hidden for pending entries */}
                  {!entry.pending && (
                    <button
                      className="flex size-6 items-center justify-center opacity-0 transition-all group-hover:opacity-100 hover:bg-muted"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (menu?.name === entry.name) {
                          setMenu(null)
                          return
                        }
                        const rect = (
                          e.currentTarget as HTMLElement
                        ).getBoundingClientRect()
                        setMenu({
                          name: entry.name,
                          entryPath,
                          isFile: entry.type === "file",
                          x: rect.right,
                          y: rect.bottom + 4,
                        })
                      }}
                      aria-label={`Actions for ${entry.name}`}
                      aria-haspopup="true"
                      aria-expanded={menu?.name === entry.name}
                    >
                      <MoreHorizontal className="size-3.5" />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Portal dropdown menu — renders outside overflow container */}
      {menu &&
        createPortal(
          <div
            role="menu"
            onMouseDown={(e) => e.stopPropagation()}
            className="fixed z-[9999] min-w-36 border border-border bg-popover py-1 shadow-lg"
            style={{ top: menu.y, left: menu.x - 144 }}
          >
            {menu.isFile ? (
              <button
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted"
                onClick={() => handleDownload(menu.name)}
              >
                <Download className="size-3.5" />
                Download
              </button>
            ) : (
              <button
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted"
                onClick={() => handleDownloadFolder(menu.name)}
              >
                <Download className="size-3.5" />
                Download as .zip
              </button>
            )}
            <button
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
              onClick={() => {
                setDeleteTargets([menu.name])
                setMenu(null)
              }}
            >
              <Trash2 className="size-3.5" />
              Delete
            </button>
          </div>,
          document.body
        )}

      {/* Delete confirm */}
      <Dialog
        open={deleteTargets !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTargets(null)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {deleteNames.length === 1
                ? `Delete ${deleteFolders ? "folder" : "file"}`
                : `Delete ${deleteNames.length} items`}
            </DialogTitle>
          </DialogHeader>
          {deleteNames.length === 1 ? (
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete{" "}
              <span className="font-mono text-foreground">
                {pathOf(deleteNames[0])}
              </span>
              {deleteFolders ? " and everything in it" : ""}? This cannot be
              undone.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                These are deleted for good
                {deleteFolders === 1
                  ? `, including everything inside ${
                      entries.find(
                        (e) =>
                          deleteNames.includes(e.name) && e.type === "directory"
                      )?.name
                    }`
                  : deleteFolders > 1
                    ? `, including everything inside the ${deleteFolders} folders`
                    : ""}
                :
              </p>
              <ul className="max-h-40 overflow-y-auto rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-xs">
                {deleteNames.map((n) => (
                  <li key={n} className="truncate">
                    {n}
                  </li>
                ))}
              </ul>
            </>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTargets(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={handleDelete}
            >
              {deleting && <Loader2 className="size-3.5 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview / editor */}
      <FileViewer
        key={opened ? `${opened.path}:${opened.edit}` : "closed"}
        serverId={serverId}
        file={opened}
        onClose={() => setOpened(null)}
        onSaved={() => loadDir(path)}
      />

      {/* Floating per-file upload progress */}
      <FileUploadProgress
        uploads={uploads}
        onDismiss={() => {
          if (dismissUploadsRef.current) clearTimeout(dismissUploadsRef.current)
          setUploads([])
        }}
      />
    </div>
  )
}
