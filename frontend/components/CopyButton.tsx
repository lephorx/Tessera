"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"

// navigator.clipboard only exists on HTTPS and localhost; CSCM is often
// opened over plain HTTP on the LAN, so fall back to a hidden textarea
async function copyText(text: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }
  const area = document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  area.style.position = "fixed"
  area.style.opacity = "0"
  document.body.appendChild(area)
  area.select()
  const ok = document.execCommand("copy")
  area.remove()
  if (!ok) throw new Error("copy failed")
}

/** small icon button that copies `value`, e.g. next to a server address */
export function CopyButton({
  value,
  label = "Copy address",
  className,
}: {
  value: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label={label}
      title={copied ? "Copied" : label}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className
      )}
      onClick={(e) => {
        // the button can sit inside a clickable card
        e.preventDefault()
        e.stopPropagation()
        copyText(value)
          .then(() => {
            setCopied(true)
            toast.success(`Copied ${value}`)
            setTimeout(() => setCopied(false), 1500)
          })
          .catch(() => toast.error("Could not copy. Select the text instead."))
      }}
    >
      {copied ? (
        <Check className="size-3.5 text-emerald-500" />
      ) : (
        <Copy className="size-3.5" />
      )}
    </button>
  )
}
