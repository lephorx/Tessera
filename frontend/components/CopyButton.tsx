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
        "modern:rounded-full modern:transition-[background-color,color,scale] modern:duration-300 modern:ease-[cubic-bezier(0.34,1.56,0.64,1)] modern:hover:bg-fill modern:active:scale-90 modern:active:duration-75",
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
      {/* modern: the icons swap with a small pop */}
      {copied ? (
        <Check
          key="copied"
          className="size-3.5 text-emerald-500 modern:animate-in modern:text-status-green modern:duration-300 modern:fade-in-0 modern:zoom-in-50"
        />
      ) : (
        <Copy key="copy" className="size-3.5" />
      )}
    </button>
  )
}
