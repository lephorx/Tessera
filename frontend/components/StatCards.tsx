import type { LucideIcon } from "lucide-react"
import { Cpu, MemoryStick, Users } from "lucide-react"

import type { ServerStats } from "@/lib/types"
import { cn, formatBytes, parsePlayers } from "@/lib/utils"

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  percent,
}: {
  label: string
  value: string
  detail?: string
  icon: LucideIcon
  /** fills the meter along the bottom edge */
  percent: number | null
}) {
  return (
    <div className="relative flex flex-col gap-1 overflow-hidden rounded-[16px] border border-border bg-card px-5 pt-4 pb-5 shadow-surface">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[13px] font-semibold text-muted-foreground">
          {label}
        </span>
        <Icon className="size-5 text-muted-foreground" strokeWidth={1.75} />
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-[26px] leading-tight font-extrabold tracking-[-0.02em] tabular-nums">
          {value}
        </span>
        {detail && (
          <span className="truncate text-[12px] font-medium text-muted-foreground tabular-nums">
            {detail}
          </span>
        )}
      </div>
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[3px] bg-surface-2"
      >
        <div
          className={cn(
            "h-full rounded-r-full bg-tint transition-[width] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]",
            percent !== null && percent >= 90 && "bg-status-red"
          )}
          style={{ width: `${percent ?? 0}%` }}
        />
      </div>
    </div>
  )
}

/** the live numbers above a server's tabs, like a hosting panel */
export function StatCards({ stats }: { stats: ServerStats | null }) {
  const running = !!stats?.running
  const cpu = running ? Math.min(100, Math.round(stats?.cpu_percent ?? 0)) : 0
  const used = stats?.memory_usage_bytes ?? 0
  const limit = stats?.memory_limit_bytes ?? 0
  const memory = running && limit > 0 ? Math.round((used / limit) * 100) : 0
  const players = stats ? parsePlayers(stats) : null

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <StatCard
        label="CPU"
        icon={Cpu}
        value={running ? `${cpu}%` : "—"}
        percent={running ? cpu : null}
      />
      <StatCard
        label="Memory"
        icon={MemoryStick}
        value={running ? `${memory}%` : "—"}
        detail={
          running && limit > 0
            ? `${formatBytes(used)} of ${formatBytes(limit)}`
            : undefined
        }
        percent={running ? memory : null}
      />
      <StatCard
        label="Players"
        icon={Users}
        value={running && players ? `${players.online}` : "—"}
        detail={
          running && players?.max ? `of ${players.max} online` : undefined
        }
        percent={
          running && players?.max
            ? Math.round((players.online / players.max) * 100)
            : null
        }
      />
    </div>
  )
}
