import type { LucideIcon } from "lucide-react"
import { Box, Feather, Gem, Hammer, Scroll, Zap } from "lucide-react"

import { cn } from "@/lib/utils"

/** a small outlined tag with an icon, e.g. a server's type or version */
export function Chip({
  icon: Icon,
  color,
  className,
  children,
}: {
  icon?: LucideIcon
  /** tints the icon (and, in dark mode, the text) */
  color?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-[8px] border border-border px-2 text-[12px] font-semibold text-muted-foreground",
        color && "dark:text-(--chip)",
        className
      )}
      style={color ? ({ "--chip": color } as React.CSSProperties) : undefined}
    >
      {Icon && (
        <Icon
          className={cn(
            "size-3.5",
            // pastel on dark; darkened so it still reads on white
            color &&
              "text-[color-mix(in_srgb,var(--chip)_55%,black)] dark:text-(--chip)"
          )}
          strokeWidth={2.25}
        />
      )}
      {children}
    </span>
  )
}

// Each server type gets the color its loader is known by, the way
// Modrinth tags Fabric, Forge and friends.
const TYPES: Record<
  string,
  { label: string; icon: LucideIcon; color: string }
> = {
  paper: { label: "Paper", icon: Feather, color: "#eeaaaa" },
  purpur: { label: "Purpur", icon: Zap, color: "#c39dff" },
  fabric: { label: "Fabric", icon: Scroll, color: "#dbb69b" },
  forge: { label: "Forge", icon: Hammer, color: "#959eef" },
  vanilla: { label: "Vanilla", icon: Box, color: "#7dd87d" },
  bedrock: { label: "Bedrock", icon: Gem, color: "#6fd2c3" },
}

export function serverTypeInfo(type: string) {
  return (
    TYPES[type] ?? {
      label: type.charAt(0).toUpperCase() + type.slice(1),
      icon: Box,
      color: "#a2a9b4",
    }
  )
}

export function TypeChip({ type }: { type: string }) {
  const { label, icon, color } = serverTypeInfo(type)
  return (
    <Chip icon={icon} color={color}>
      {label}
    </Chip>
  )
}
