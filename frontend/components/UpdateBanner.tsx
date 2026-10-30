"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, TriangleAlert, X } from "lucide-react"
import { toast } from "sonner"

import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const HELP_URL = "https://lephor.com/wiki/cscm/help"
const HELP_FAILED = `${HELP_URL}#update-failed`
const HELP_MANUAL = `${HELP_URL}#manual-update`
const RECHECK_MS = 30 * 60 * 1000
const POLL_MS = 3000

interface VersionInfo {
  current: string
  latest: string | null
  update_available: boolean
  can_update: boolean
  reason: string | null
  check_error: string | null
}

interface UpdateStatus {
  state: "idle" | "running" | "done" | "failed"
  log: string[]
  version: string
}

type Phase =
  | "idle"
  | "confirm"
  | "starting"
  | "running"
  | "restarting"
  | "failed"

// Permanent banner shown while a newer Tessera version exists. "Update" starts
// the backend's update helper, then follows its progress through the restart
// and reloads the dashboard once the new version answers. Bumping
// `checkRequest` asks GitHub right away (the "Check for updates" button).
export function UpdateBanner({ checkRequest = 0 }: { checkRequest?: number }) {
  const [info, setInfo] = useState<VersionInfo | null>(null)
  const [phase, setPhase] = useState<Phase>("idle")
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState("")
  // version the user hid the banner for (until reload or a manual check)
  const [hiddenFor, setHiddenFor] = useState<string | null>(null)
  const fromVersion = useRef("")
  const logEnd = useRef<HTMLDivElement>(null)

  const check = useCallback(async () => {
    try {
      setInfo(await api.system.version())
    } catch {
      // not critical; try again on the next interval
    }
  }, [])

  // Manual check: skip the hourly cache and say what was found. A found
  // update just brings the banner back; updating stays one click on it.
  useEffect(() => {
    if (!checkRequest) return
    api.system
      .version(true)
      .then((v: VersionInfo) => {
        setInfo(v)
        setHiddenFor(null)
        if (v.update_available) return
        if (v.check_error) toast.error(v.check_error)
        else toast.success(`Tessera is up to date (${v.current})`)
      })
      .catch(() => toast.error("Could not check for updates"))
  }, [checkRequest])

  // Initial check, a periodic re-check, and resuming an update that was
  // already running when the page was (re)loaded.
  useEffect(() => {
    check()
    const id = setInterval(check, RECHECK_MS)
    api.system
      .updateStatus()
      .then((s: UpdateStatus) => {
        if (s?.state === "running") {
          fromVersion.current = s.version
          setLog(s.log)
          setPhase("running")
        }
      })
      .catch(() => {})
    return () => clearInterval(id)
  }, [check])

  // Follow the update while it runs.
  useEffect(() => {
    if (phase !== "running" && phase !== "restarting") return
    const id = setInterval(async () => {
      try {
        const s: UpdateStatus = await api.system.updateStatus()
        setLog(s.log)
        if (s.state === "failed") {
          setError(s.log[s.log.length - 1] ?? "The update failed.")
          setPhase("failed")
        } else if (s.state === "done" && s.version !== fromVersion.current) {
          toast.success(`Tessera updated to ${s.version}`)
          window.location.reload()
        } else {
          setPhase("running")
        }
      } catch {
        // the API is being rebuilt and restarted right now
        setPhase("restarting")
      }
    }, POLL_MS)
    return () => clearInterval(id)
  }, [phase])

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "end" })
  }, [log])

  async function startUpdate() {
    // show progress right away; the request and the first poll take a moment
    setError("")
    fromVersion.current = info?.current ?? ""
    setLog(["Contacting Tessera…"])
    setPhase("starting")
    try {
      await api.system.update()
      setPhase("running")
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not start the update"
      )
      setPhase("failed")
    }
  }

  const busy =
    phase === "starting" || phase === "running" || phase === "restarting"
  if (!info?.update_available && !busy && phase !== "failed") return null

  return (
    <>
      {/* a yellow warning bar across the bottom; it floats over the page
          (and the version badge) so it never shifts the layout */}
      {info?.update_available && (busy || hiddenFor !== info.latest) && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-amber-500 bg-amber-400 text-amber-950 shadow-lg"
        >
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2 px-4 py-2.5">
            <p className="flex flex-1 items-center gap-2 text-sm">
              <TriangleAlert className="size-4 shrink-0" />
              <span>
                <span className="font-medium">Tessera {info.latest}</span> is
                available. You&apos;re on {info.current}.
              </span>
            </p>
            {info.can_update ? (
              <Button
                size="sm"
                disabled={busy}
                className="bg-amber-950 text-amber-50 hover:bg-amber-900"
                onClick={() => setPhase("confirm")}
              >
                {busy && <Loader2 className="size-3.5 animate-spin" />}
                {busy ? "Updating…" : "Update"}
              </Button>
            ) : (
              <a
                href={HELP_MANUAL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-amber-900 underline underline-offset-4"
              >
                {info.reason} How to update manually
              </a>
            )}
            {!busy && (
              <Button
                size="icon"
                variant="ghost"
                className="size-7 text-amber-950 hover:bg-amber-500/60 hover:text-amber-950"
                aria-label="Hide"
                title="Hide until the next check"
                onClick={() => setHiddenFor(info.latest)}
              >
                <X className="size-3.5" />
              </Button>
            )}
          </div>
        </div>
      )}

      <Dialog
        open={phase !== "idle"}
        onOpenChange={(open) => {
          // can't be closed while the update runs
          if (!open && !busy) setPhase("idle")
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {phase === "confirm" && `Update to Tessera ${info?.latest}`}
              {(phase === "starting" || phase === "running") &&
                "Updating Tessera…"}
              {phase === "restarting" && "Restarting Tessera…"}
              {phase === "failed" && "Update failed"}
            </DialogTitle>
          </DialogHeader>

          {phase === "confirm" && (
            <p className="text-sm text-muted-foreground">
              Tessera downloads the new version from GitHub and rebuilds itself.
              The dashboard is offline for a few minutes and reloads on its own
              when it&apos;s back. Your Minecraft servers keep running, and your
              settings, worlds and backups are kept.
            </p>
          )}

          {(busy || phase === "failed") && (
            <>
              {busy && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {phase === "restarting"
                    ? "Waiting for Tessera to come back online…"
                    : "This takes a few minutes. Keep this page open."}
                </p>
              )}
              {phase === "failed" && (
                <p className="flex items-start gap-2 text-sm text-destructive">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  <span>
                    {error}{" "}
                    <a
                      href={HELP_FAILED}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-4"
                    >
                      Help page
                    </a>
                  </span>
                </p>
              )}
              {log.length > 0 && (
                <div className="max-h-56 overflow-y-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {log.map((line, i) => (
                    <div key={i} className="break-words whitespace-pre-wrap">
                      {line}
                    </div>
                  ))}
                  <div ref={logEnd} />
                </div>
              )}
            </>
          )}

          {(phase === "confirm" || phase === "failed") && (
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setPhase("idle")}>
                {phase === "failed" ? "Close" : "Cancel"}
              </Button>
              <Button onClick={startUpdate}>
                {phase === "failed" ? "Try again" : "Update now"}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
