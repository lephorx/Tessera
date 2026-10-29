"use client"

import { useEffect, useState } from "react"

import { api } from "@/lib/api"

// Installed CSCM version, pinned to the bottom left of every page. Floats
// over the content, so it never shifts the layout.
export function VersionBadge() {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    api
      .version()
      .then((res) => setVersion(res.version))
      .catch(() => {})
  }, [])

  if (!version) return null
  return (
    <div className="pointer-events-none fixed bottom-3 left-3 z-30 rounded-md border border-border bg-card/80 px-2 py-1 font-mono text-[11px] text-muted-foreground backdrop-blur-sm select-none">
      CSCM v{version}
    </div>
  )
}
