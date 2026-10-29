import type { ServerState, ServerStats } from "@/lib/types"
import { cn } from "@/lib/utils"

const STATES: Record<ServerState, { label: string; dot: string }> = {
  not_created: { label: "Not created", dot: "bg-zinc-400" },
  starting: { label: "Starting", dot: "bg-sky-500 animate-pulse" },
  running: { label: "Running", dot: "bg-emerald-500" },
  unhealthy: { label: "Unhealthy", dot: "bg-red-500" },
  stopping: { label: "Stopping", dot: "bg-amber-500 animate-pulse" },
  restarting: { label: "Restarting", dot: "bg-blue-500 animate-pulse" },
  stopped: { label: "Stopped", dot: "bg-zinc-400" },
}

/** states that change on their own soon, so they're worth polling faster */
export const TRANSITIONAL_STATES: ServerState[] = [
  "starting",
  "stopping",
  "restarting",
]

type PendingAction = "start" | "stop" | "restart" | "kill" | null

/** the state to show: a button just pressed wins over the last poll */
export function serverState(
  stats: ServerStats | null,
  pending: PendingAction = null
): ServerState | null {
  if (pending === "start") return "starting"
  if (pending === "stop" || pending === "kill") return "stopping"
  if (pending === "restart") return "restarting"
  if (!stats) return null
  // older backends only report whether it runs
  return stats.state ?? (stats.running ? "running" : "stopped")
}

export function ServerStateBadge({
  state,
  className,
}: {
  state: ServerState | null
  className?: string
}) {
  if (!state) return null
  const { label, dot } = STATES[state]
  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground",
        className
      )}
    >
      <span className={cn("size-2 shrink-0 rounded-full", dot)} />
      {label}
    </span>
  )
}
