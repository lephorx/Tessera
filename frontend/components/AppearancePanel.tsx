"use client"

import { useEffect, useRef, useState } from "react"
import { ImageUp, Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ServerIcon } from "@/components/ServerIcon"
import { api } from "@/lib/api"
import {
  MC_COLORS,
  MC_STYLES,
  SECTION,
  parseMinecraftText,
} from "@/lib/minecraftText"
import type { AppearanceSaved, Server, ServerAppearance } from "@/lib/types"
import { cn } from "@/lib/utils"

const ICON_SIZE = 64

/** crop a picture to a centered square and scale it to the 64x64 PNG
 *  Minecraft wants */
async function toServerIcon(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That file isn't an image the browser can read")
  })
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement("canvas")
  canvas.width = ICON_SIZE
  canvas.height = ICON_SIZE
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Could not process the image")
  // pixel art stays crisp when it's already small, photos get smoothed
  ctx.imageSmoothingEnabled = side > ICON_SIZE * 2
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    ICON_SIZE,
    ICON_SIZE
  )
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Could not process the image")),
      "image/png"
    )
  )
}

function savedToast(result: AppearanceSaved, fallback: string) {
  toast.success(result.message ?? fallback, {
    description: result.restart_required
      ? "Restart the server for players to see it."
      : undefined,
  })
}

/** one description line the way the multiplayer screen draws it */
function McLine({ text, color }: { text: string; color?: string }) {
  return (
    <>
      {parseMinecraftText(text, color).map((line, i) => (
        <p key={i} className="min-h-[1.25em] truncate whitespace-pre">
          {line.map((seg, j) => (
            <span
              key={j}
              style={{
                color: seg.color,
                textDecorationLine:
                  [seg.underline && "underline", seg.strike && "line-through"]
                    .filter(Boolean)
                    .join(" ") || undefined,
              }}
              className={cn(
                seg.bold && "font-bold",
                seg.italic && "italic",
                seg.obfuscated && "blur-[2px]"
              )}
            >
              {seg.text}
            </span>
          ))}
        </p>
      ))}
    </>
  )
}

export function AppearancePanel({
  server,
  onChanged,
}: {
  server: Server
  /** reloads the server, so the new icon shows up elsewhere too */
  onChanged: () => void
}) {
  const [appearance, setAppearance] = useState<ServerAppearance | null>(null)
  const [description, setDescription] = useState("")
  const [saving, setSaving] = useState(false)
  const [iconBusy, setIconBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    api.appearance
      .get(server.id)
      .then((res) => {
        if (cancelled) return
        setAppearance(res)
        setDescription(res.description)
      })
      .catch(() => toast.error("Failed to load the server's appearance"))
    return () => {
      cancelled = true
    }
  }, [server.id])

  if (!appearance) {
    return (
      <div className="flex items-center gap-2 px-6 py-4 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Loading appearance…
      </div>
    )
  }

  const bedrock = !appearance.multiline
  const dirty = description !== appearance.description
  const lines = description.split("\n").length
  const iconVersion = server.icon_version ?? appearance.icon_version

  /** put a § code at the cursor (or around the selection, then reset) */
  function insertCode(code: string) {
    const el = textRef.current
    const start = el?.selectionStart ?? description.length
    const end = el?.selectionEnd ?? description.length
    const selected = description.slice(start, end)
    const insert = selected
      ? `${SECTION}${code}${selected}${SECTION}r`
      : `${SECTION}${code}`
    const next = description.slice(0, start) + insert + description.slice(end)
    if (next.length > appearance!.max_length) return
    setDescription(next)
    requestAnimationFrame(() => {
      el?.focus()
      const cursor = start + insert.length
      el?.setSelectionRange(cursor, cursor)
    })
  }

  async function saveDescription() {
    setSaving(true)
    try {
      const result = await api.appearance.setDescription(server.id, description)
      setAppearance((a) => a && { ...a, description })
      savedToast(result, "Description saved")
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save the description"
      )
    } finally {
      setSaving(false)
    }
  }

  async function uploadIcon(file: File) {
    setIconBusy(true)
    try {
      const icon = await toServerIcon(file)
      savedToast(await api.appearance.setIcon(server.id, icon), "Icon saved")
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to upload icon")
    } finally {
      setIconBusy(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  async function removeIcon() {
    setIconBusy(true)
    try {
      savedToast(await api.appearance.removeIcon(server.id), "Icon removed")
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove icon")
    } finally {
      setIconBusy(false)
    }
  }

  return (
    <div className="space-y-5 px-6 py-5">
      <div>
        <p className="text-xs text-muted-foreground">Server list appearance</p>
        <p className="text-sm font-medium">
          What players see in their multiplayer list
        </p>
      </div>

      {/* Preview, styled after Minecraft's multiplayer screen */}
      <div className="flex max-w-xl items-center gap-3 rounded-md bg-[#1b1b1b] p-2 font-mono text-[13px] leading-tight text-[#AAAAAA]">
        {!bedrock && (
          <ServerIcon
            serverId={server.id}
            iconVersion={iconVersion}
            className="size-16 rounded-none border-0 bg-[#2a2a2a]"
          />
        )}
        <div className="min-w-0 flex-1 py-0.5">
          {bedrock ? (
            <McLine
              text={description || "Dedicated Server"}
              color={MC_COLORS.f.hex}
            />
          ) : (
            <>
              <p className="mb-0.5 truncate text-white">{server.name}</p>
              <McLine text={description || "A Minecraft Server"} />
            </>
          )}
        </div>
      </div>

      {/* Icon (Java only) */}
      {appearance.icon_supported ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) uploadIcon(file)
            }}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={iconBusy}
            onClick={() => fileRef.current?.click()}
          >
            {iconBusy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ImageUp className="size-3.5" />
            )}
            {iconVersion != null ? "Change icon" : "Upload icon"}
          </Button>
          {iconVersion != null && (
            <Button
              size="sm"
              variant="outline"
              disabled={iconBusy}
              onClick={removeIcon}
            >
              <Trash2 className="size-3.5" />
              Remove
            </Button>
          )}
          <p className="text-[11px] text-muted-foreground">
            Any picture works: it&apos;s cropped to a square and scaled to
            64×64.
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Bedrock servers can&apos;t have an icon.
        </p>
      )}

      {/* Description */}
      <div className="max-w-xl space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor="server-description"
            className="text-xs text-muted-foreground"
          >
            {bedrock ? "Server name shown to players" : "Description (MOTD)"}
          </label>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {description.length}/{appearance.max_length}
          </span>
        </div>

        {/* formatting codes */}
        <div className="flex flex-wrap items-center gap-1">
          {Object.entries(MC_COLORS).map(([code, { name, hex }]) => (
            <button
              key={code}
              type="button"
              title={name}
              aria-label={`Insert ${name}`}
              onClick={() => insertCode(code)}
              className="size-5 rounded-sm border border-border transition-transform hover:scale-110"
              style={{ backgroundColor: hex }}
            />
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          {Object.entries(MC_STYLES).map(([code, name]) => (
            <button
              key={code}
              type="button"
              title={name}
              onClick={() => insertCode(code)}
              className={cn(
                "h-5 rounded-sm border border-border px-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground",
                code === "l" && "font-bold",
                code === "o" && "italic",
                code === "n" && "underline",
                code === "m" && "line-through"
              )}
            >
              {name === "Obfuscated" ? "Magic" : name}
            </button>
          ))}
        </div>

        {bedrock ? (
          <Input
            id="server-description"
            ref={textRef}
            value={description}
            maxLength={appearance.max_length}
            onChange={(e) => setDescription(e.target.value)}
          />
        ) : (
          <textarea
            id="server-description"
            ref={textRef}
            rows={2}
            value={description}
            maxLength={appearance.max_length}
            placeholder="A Minecraft Server"
            onChange={(e) =>
              // the server list shows two lines at most
              setDescription(e.target.value.split("\n").slice(0, 2).join("\n"))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" && lines >= 2) e.preventDefault()
            }}
            className="w-full resize-none rounded-lg border border-input bg-transparent px-2.5 py-1.5 font-mono text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />
        )}
        <p className="text-[11px] text-muted-foreground">
          {bedrock
            ? "One line. Select text and pick a color to format just that part."
            : "Up to two lines. Select text and pick a color to format just that part."}
        </p>

        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={!dirty || saving || (bedrock && !description.trim())}
            onClick={saveDescription}
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            Save description
          </Button>
          {dirty && (
            <Button
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() => setDescription(appearance.description)}
            >
              Discard
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
