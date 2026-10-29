"use client"

import { useState, useCallback } from "react"
import Link from "next/link"
import {
  Loader2,
  Play,
  Square,
  Skull,
  Settings,
  Users,
  Network,
  TriangleAlert,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import type { Server, ServerProgress, ServerStats } from "@/lib/types"
import { useSmoothPercent } from "@/hooks/useSmoothPercent"
import { api } from "@/lib/api"
import { parsePlayers, serverConnectAddress } from "@/lib/utils"
import { CopyButton } from "@/components/CopyButton"

interface Props {
  server: Server
  stats: ServerStats | null
  onRefresh: () => void
  /** signed-in user; other users' servers (seen by admins) show their owner */
  viewerId?: number
}

type Action = "stop" | "kill" | null

// Covers the whole card while the server is being created or deleted, like
// the old dashboard did; the card underneath can't be used meanwhile.
function OperationOverlay({
  progress,
  percent,
}: {
  progress: ServerProgress
  percent: number
}) {
  const isDelete = progress.action === "delete"
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-card/90 px-5 text-center backdrop-blur-[1px]">
      <div className="flex items-center gap-2">
        {isDelete ? (
          <Trash2 className="size-4 text-destructive" />
        ) : (
          <Loader2 className="size-4 animate-spin text-primary" />
        )}
        <span className="text-sm font-medium">
          {isDelete ? "Deleting server…" : "Creating server…"}
        </span>
      </div>
      {progress.step && (
        <p className="text-xs text-muted-foreground">{progress.step}</p>
      )}
      <Progress
        value={percent}
        className={`h-1.5 w-full max-w-[180px] ${isDelete ? "[&>div]:bg-destructive" : ""}`}
      />
      <span className="text-[11px] text-muted-foreground tabular-nums">
        {percent}%
      </span>
    </div>
  )
}

export function ServerCard({ server, stats, onRefresh, viewerId }: Props) {
  const [loadingAction, setLoadingAction] = useState<
    "start" | "stop" | "kill" | null
  >(null)
  const [confirmAction, setConfirmAction] = useState<Action>(null)

  const isRunning = stats?.running ?? false
  const progress = server.progress
  const busy = progress?.status === "in_progress"
  const deleting = busy && progress?.action === "delete"
  // creation and deletion cover the card; a tunnel retry only shows a line
  const overlay =
    busy && (progress?.action === "delete" || progress?.action === "provision")
  const percent = useSmoothPercent(progress?.percent ?? 0, busy)

  const statusDot = isRunning ? "bg-emerald-500" : "bg-zinc-400"

  const statusText = isRunning ? "Running" : "Stopped"

  async function execAction(action: "start" | "stop" | "kill") {
    setLoadingAction(action)
    try {
      if (action === "start") await api.control.start(server.id)
      else if (action === "stop") await api.control.stop(server.id)
      else await api.control.kill(server.id)
      toast.success(
        `Server ${action === "start" ? "started" : action === "stop" ? "stopped" : "killed"}`
      )
      onRefresh()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : `Failed to ${action} server`
      )
    } finally {
      setLoadingAction(null)
    }
  }

  const handleConfirm = useCallback(async () => {
    if (!confirmAction) return
    const action = confirmAction
    setConfirmAction(null)
    await execAction(action)
  }, [confirmAction])

  return (
    <>
      <div
        className="relative flex flex-col gap-4 border border-border bg-card p-5"
        inert={overlay || undefined}
      >
        {overlay && progress && (
          <OperationOverlay progress={progress} percent={percent} />
        )}
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-base leading-tight font-semibold">
              {server.name}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground capitalize">
              {server.type} · {server.version}
            </p>
            {server.owner && server.owner.id !== viewerId && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                Owner: {server.owner.username}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className={`size-2 rounded-full ${statusDot}`} />
            <span className="text-xs font-medium text-muted-foreground">
              {statusText}
            </span>
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Users className="size-3" />
            {isRunning && stats
              ? (() => {
                  const { online, max } = parsePlayers(stats)
                  return `${online}/${max ?? "—"}`
                })()
              : "—"}{" "}
            players
          </span>
          <span className="flex items-center gap-1">
            <Network className="size-3" />:{server.port}
          </span>
        </div>

        {/* Tunnel retry in progress, or why something failed */}
        {progress && !overlay && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span
                className={`flex min-w-0 items-center gap-1.5 ${progress.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}
              >
                {busy ? (
                  <Loader2 className="size-3 shrink-0 animate-spin" />
                ) : (
                  <TriangleAlert className="size-3 shrink-0" />
                )}
                <span
                  className="truncate"
                  title={progress.message ?? progress.step ?? ""}
                >
                  {progress.status === "failed"
                    ? `${progress.action === "delete" ? "Deletion" : progress.action === "tunnel" ? "Tunnel" : "Setup"} failed: ${progress.message ?? progress.step}`
                    : (progress.step ?? "Setting up…")}
                </span>
              </span>
              {busy && (
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {percent}%
                </span>
              )}
            </div>
            {busy && <Progress value={percent} className="h-1" />}
          </div>
        )}

        {/* PlayIT tunnel */}
        {server.local_only ? (
          <p className="truncate text-xs text-muted-foreground">
            Local only —{" "}
            {typeof window !== "undefined" ? window.location.hostname : "—"}
          </p>
        ) : server.tunnels.length === 0 ? (
          !progress &&
          (server.tunnel_error || server.playit_configured === false) && (
            <p
              className="flex items-center gap-1.5 truncate text-xs text-amber-600 dark:text-amber-400"
              title={server.tunnel_error ?? "Playit isn't set up"}
            >
              <TriangleAlert className="size-3 shrink-0" />
              No public address. Open the server for details.
            </p>
          )
        ) : (
          server.tunnels.length > 0 && (
            <div className="text-xs text-muted-foreground">
              <p className="flex min-w-0 items-center gap-1">
                <span className="truncate">{serverConnectAddress(server)}</span>
                <CopyButton
                  value={serverConnectAddress(server) ?? ""}
                  className="size-5"
                />
              </p>
              {server.type === "bedrock" && server.tunnels.length > 0 && (
                <p className="truncate font-medium text-foreground">
                  Port {server.tunnels[0].external_port}
                </p>
              )}
            </div>
          )
        )}

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={busy || isRunning || loadingAction !== null}
            onClick={() => execAction("start")}
            aria-label="Start server"
          >
            {loadingAction === "start" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5" />
            )}
            Start
          </Button>
          <Button
            size="sm"
            className="flex-1 bg-amber-500 text-white hover:bg-amber-600"
            disabled={busy || !isRunning || loadingAction !== null}
            onClick={() => setConfirmAction("stop")}
            aria-label="Stop server"
          >
            {loadingAction === "stop" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Square className="size-3.5" />
            )}
            Stop
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="flex-1"
            disabled={busy || loadingAction !== null}
            onClick={() => setConfirmAction("kill")}
            aria-label="Kill server"
          >
            {loadingAction === "kill" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Skull className="size-3.5" />
            )}
            Kill
          </Button>
        </div>

        {deleting ? (
          <Button variant="outline" size="sm" className="w-full" disabled>
            <Settings className="size-3.5" />
            Manage
          </Button>
        ) : (
          <Link href={`/servers/${server.id}`} className="block w-full">
            <Button variant="outline" size="sm" className="w-full">
              <Settings className="size-3.5" />
              Manage
            </Button>
          </Link>
        )}
      </div>

      {/* Confirm dialog */}
      <Dialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {confirmAction === "kill" ? "Force Kill Server" : "Stop Server"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {confirmAction === "kill"
              ? "This will immediately terminate the server process. Any unsaved data will be lost."
              : "This will gracefully stop the server, saving world data."}
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
            <Button
              variant={confirmAction === "kill" ? "destructive" : "default"}
              className={
                confirmAction === "stop"
                  ? "bg-amber-500 text-white hover:bg-amber-600"
                  : ""
              }
              onClick={handleConfirm}
            >
              {confirmAction === "kill" ? "Kill" : "Stop"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
