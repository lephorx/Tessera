"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

import { api } from "@/lib/api"

// Installed Tessera version, pinned to the bottom left of every page. Floats
// over the content, so it never shifts the layout. Opens About & privacy.
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
    <Link
      href="/about"
      title="About & privacy"
      className="fixed bottom-3 left-3 z-30 rounded-md border border-border bg-card/80 px-2 py-1 font-mono text-[11px] text-muted-foreground backdrop-blur-sm transition-colors select-none hover:text-foreground modern:rounded-full modern:border-separator modern:material modern:px-2.5"
    >
      Tessera v{version}
    </Link>
  )
}
