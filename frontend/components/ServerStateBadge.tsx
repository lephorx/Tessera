import type { ServerState, ServerStats } from "@/lib/types"
import { cn } from "@/lib/utils"

// `dot` is the classic look; `capsule` the modern tinted pill in the
// matching system color. The label always says the state, so color is
// never the only cue.
const STATES: Record<
  ServerState,
  { label: string; dot: string; capsule: string; busy?: boolean }
> = {
  not_created: {
    label: "Not created",
    dot: "bg-zinc-400",
    capsule: "modern:bg-status-gray/15 modern:text-status-gray",
  },
  starting: {
    label: "Starting",
    dot: "bg-sky-500 animate-pulse",
    capsule: "modern:bg-status-blue/15 modern:text-status-blue",
    busy: true,
  },
  running: {
    label: "Running",
    dot: "bg-emerald-500",
    capsule: "modern:bg-status-green/15 modern:text-status-green",
  },
  unhealthy: {
    label: "Unhealthy",
    dot: "bg-red-500",
    capsule: "modern:bg-status-red/15 modern:text-status-red",
  },
  stopping: {
    label: "Stopping",
    dot: "bg-amber-500 animate-pulse",
    capsule: "modern:bg-status-orange/15 modern:text-status-orange",
    busy: true,
  },
  restarting: {
    label: "Restarting",
    dot: "bg-blue-500 animate-pulse",
    capsule: "modern:bg-status-blue/15 modern:text-status-blue",
    busy: true,
  },
  stopped: {
    label: "Stopped",
    dot: "bg-zinc-400",
    capsule: "modern:bg-status-gray/15 modern:text-status-gray",
  },
}

const MODERN_DOT: Record<ServerState, string> = {
  not_created: "modern:bg-status-gray",
  starting: "modern:bg-status-blue",
  running: "modern:bg-status-green",
  unhealthy: "modern:bg-status-red",
  stopping: "modern:bg-status-orange",
  restarting: "modern:bg-status-blue",
  stopped: "modern:bg-status-gray",
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
  const { label, dot, capsule, busy } = STATES[state]
  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground",
        "modern:h-6 modern:rounded-full modern:px-2.5 modern:font-semibold",
        capsule,
        className
      )}
    >
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          dot,
          "modern:size-1.5",
          MODERN_DOT[state],
          busy && "motion-reduce:animate-none"
        )}
      />
      {label}
    </span>
  )
}
