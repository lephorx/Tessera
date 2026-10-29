"use client"

import { useEffect, useState } from "react"
import { Box } from "lucide-react"

import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

/** the server's 64x64 icon, or a placeholder when it has none. The image
 *  needs the login token, so it's fetched rather than linked. */
export function ServerIcon({
  serverId,
  iconVersion,
  className,
}: {
  serverId: number
  /** from the server listing; a new value fetches the icon again */
  iconVersion?: number | null
  className?: string
}) {
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(
    null
  )
  const key = `${serverId}:${iconVersion}`

  useEffect(() => {
    if (iconVersion == null) return
    let url: string | null = null
    let cancelled = false
    api.appearance
      .icon(serverId)
      .then((blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setLoaded({ key: `${serverId}:${iconVersion}`, url })
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [serverId, iconVersion])

  const src = iconVersion != null && loaded?.key === key ? loaded.url : null

  return (
    <div
      className={cn(
        "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted",
        className
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- blob URL
        <img
          src={src}
          alt=""
          className="size-full object-cover [image-rendering:pixelated]"
        />
      ) : (
        <Box className="size-1/2 text-muted-foreground" aria-hidden />
      )}
    </div>
  )
}
