"use client"

import { useCallback, useEffect, useState } from "react"
import { Cloud, Loader2, Unplug } from "lucide-react"
import { toast } from "sonner"

import { api, type CloudAuditEntry, type CloudStatus } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { CopyButton } from "@/components/CopyButton"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// Link this CSCM to a Tessera account, so it can be managed from the cloud
// dashboard and the launcher. The connection is outbound only: no ports to
// open. Without a link CSCM works exactly as before.
export function CloudPanel() {
  const [status, setStatus] = useState<CloudStatus | null>(null)
  const [audit, setAudit] = useState<CloudAuditEntry[]>([])
  const [cloudUrl, setCloudUrl] = useState("")
  const [busy, setBusy] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

  const load = useCallback(async () => {
    try {
      const next = await api.cloud.status()
      setStatus(next)
      setCloudUrl((url) => url || next.cloud_url || "")
      if (next.linked) setAudit((await api.cloud.audit()).entries.slice(0, 20))
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not load the cloud status"
      )
    }
  }, [])

  useEffect(() => {
    const first = async () => {
      await load()
    }
    void first()
  }, [load])

  // follow the pairing code and the connection while this tab is open
  const waiting = !!status?.pairing || (status?.linked && !status.connected)
  useEffect(() => {
    if (!status?.linked && !status?.pairing) return
    const timer = setInterval(load, waiting ? 2000 : 10000)
    return () => clearInterval(timer)
  }, [status?.linked, status?.pairing, waiting, load])

  async function run(action: () => Promise<CloudStatus>) {
    setBusy(true)
    try {
      setStatus(await action())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  if (!status) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const pairing = status.pairing

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border p-6">
        <div className="mb-4">
          <h2 className="text-sm font-semibold">Tessera Cloud</h2>
          <p className="text-xs text-muted-foreground">
            Manage this machine from the cloud dashboard and the Tessera
            Launcher. It connects out to the cloud, so no ports need to be
            opened. Everything keeps working here without it.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Once linked, this machine&apos;s name and the requests made from the
            cloud dashboard or launcher (and their responses) pass through
            Tessera Cloud. See its{" "}
            <a
              href="https://tesseralauncher.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:text-foreground"
            >
              privacy policy
            </a>{" "}
            and{" "}
            <a
              href="https://tesseralauncher.com/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:text-foreground"
            >
              terms
            </a>
            .
          </p>
        </div>

        {status.linked ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <span
                className={
                  status.connected
                    ? "size-2 rounded-full bg-emerald-500"
                    : "size-2 animate-pulse rounded-full bg-amber-500"
                }
              />
              <span className="font-medium">
                {status.connected ? "Connected" : "Reconnecting…"}
              </span>
              <span className="truncate text-muted-foreground">
                {status.cloud_url}
              </span>
            </div>
            {!status.connected && status.last_error && (
              <p className="text-xs text-muted-foreground">
                {status.last_error}
              </p>
            )}
            {status.paired_at && (
              <p className="text-xs text-muted-foreground">
                Paired on {new Date(status.paired_at).toLocaleDateString()}
              </p>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmDisconnect(true)}
            >
              <Unplug className="size-3.5" />
              Disconnect
            </Button>
          </div>
        ) : pairing ? (
          <div className="space-y-4">
            {pairing.error ? (
              <p className="text-sm text-destructive">{pairing.error}</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  In your Tessera account, choose <b>Add machine</b> and enter
                  this code:
                </p>
                <div className="flex items-center justify-center gap-2">
                  <span className="font-mono text-3xl font-semibold tracking-[0.2em] tabular-nums">
                    {pairing.code}
                  </span>
                  <CopyButton value={pairing.code} label="Copy code" />
                </div>
                <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  Waiting for the code… it works until{" "}
                  {new Date(pairing.expires_at * 1000).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => run(api.cloud.cancelPairing)}
            >
              {pairing.error ? "Back" : "Cancel"}
            </Button>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              run(() => api.cloud.pair(cloudUrl.trim()))
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="cloud-url">Cloud address</Label>
              <Input
                id="cloud-url"
                placeholder="https://cloud.example.com"
                value={cloudUrl}
                onChange={(e) => setCloudUrl(e.target.value)}
              />
            </div>
            <Button type="submit" size="sm" disabled={busy || !cloudUrl.trim()}>
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Cloud className="size-3.5" />
              )}
              Connect to your Tessera account
            </Button>
          </form>
        )}
      </section>

      {status.linked && (
        <section className="rounded-lg border border-border p-6">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="block font-medium">Allow remote admin</span>
              <span className="block text-xs text-muted-foreground">
                Lets cloud admins change connection settings and users and
                update CSCM. Servers can always be managed remotely.
              </span>
            </span>
            <Switch
              checked={status.allow_remote_admin}
              disabled={busy}
              onCheckedChange={(checked) =>
                run(() => api.cloud.setRemoteAdmin(checked))
              }
            />
          </label>
        </section>
      )}

      {status.linked && (
        <section className="rounded-lg border border-border p-6">
          <h2 className="mb-1 text-sm font-semibold">Recent remote activity</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Every request that came through the cloud.
          </p>
          {audit.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {audit.map((entry, i) => (
                <li key={i} className="flex items-center gap-2 py-1.5 text-xs">
                  <span className="w-14 shrink-0 font-mono text-muted-foreground">
                    {entry.method}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono">
                    {entry.path}
                  </span>
                  <span
                    className={
                      entry.status >= 400
                        ? "font-mono text-destructive tabular-nums"
                        : "font-mono text-muted-foreground tabular-nums"
                    }
                  >
                    {entry.status}
                  </span>
                  <span className="w-20 shrink-0 truncate text-right text-muted-foreground">
                    {entry.username}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Dialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Disconnect from the cloud?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This machine can no longer be managed from the cloud dashboard or
            the launcher. Your servers keep running. To connect again you need a
            new code.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDisconnect(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const next = await api.cloud.disconnect()
                  setConfirmDisconnect(false)
                  toast.success("Disconnected from the cloud")
                  return next
                })
              }
            >
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
