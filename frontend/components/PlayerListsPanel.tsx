"use client"

import { useEffect, useState } from "react"
import { Ban, Loader2, Plus, ShieldCheck, Users, X } from "lucide-react"
import { toast } from "sonner"

import { api, type PlayerLists } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/

// Default players (whitelist / operators every new server starts with) and
// the global ban list of the signed-in user.
export function PlayerListsPanel() {
  const [lists, setLists] = useState<PlayerLists | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    api.playerLists
      .get()
      .then(setLists)
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : "Could not load")
      )
  }, [])

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key)
    try {
      await action()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setBusy(null)
    }
  }

  const applyToAll = () =>
    run("apply", async () => {
      const res = await api.playerLists.applyToAll()
      const failed = res.servers.filter((s) => s.failed.length)
      if (!res.servers.length) toast.info("You don't have any servers yet")
      else if (failed.length)
        toast.error(
          `Not added everywhere: ${failed
            .map((s) => `${s.server} (${s.failed.join("; ")})`)
            .join(", ")}`,
          { duration: 15000 }
        )
      else
        toast.success(
          `Added to ${res.servers.length} server${res.servers.length === 1 ? "" : "s"}`
        )
    })

  if (!lists) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="space-y-5 rounded-lg border border-border p-6">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Users className="size-4" />
            Default players
          </h2>
          <p className="text-xs text-muted-foreground">
            Every new server of yours starts with these players. The whitelist
            only keeps others out when it is turned on (white-list in the
            server&apos;s properties). Bedrock servers get the whitelist only.
          </p>
        </div>
        <NameList
          title="Whitelisted"
          icon={<ShieldCheck className="size-3.5 text-emerald-500" />}
          names={lists.whitelist}
          busy={busy}
          busyKey="whitelist"
          onAdd={(name) =>
            run("whitelist", async () =>
              setLists(await api.playerLists.add("whitelist", name))
            )
          }
          onRemove={(name) =>
            run(`whitelist-${name}`, async () =>
              setLists(await api.playerLists.remove("whitelist", name))
            )
          }
        />
        <NameList
          title="Operators"
          icon={<ShieldCheck className="size-3.5 text-primary" />}
          names={lists.ops}
          busy={busy}
          busyKey="ops"
          onAdd={(name) =>
            run("ops", async () =>
              setLists(await api.playerLists.add("ops", name))
            )
          }
          onRemove={(name) =>
            run(`ops-${name}`, async () =>
              setLists(await api.playerLists.remove("ops", name))
            )
          }
        />
        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-xs text-muted-foreground">
            Changes here apply to new servers. Your existing servers keep their
            players unless you add them there too.
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={
              busy !== null || (!lists.whitelist.length && !lists.ops.length)
            }
            onClick={applyToAll}
          >
            {busy === "apply" && <Loader2 className="size-3.5 animate-spin" />}
            Add to existing servers
          </Button>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-border p-6">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Ban className="size-4 text-destructive" />
            Global bans
          </h2>
          <p className="text-xs text-muted-foreground">
            Banning someone on one of your servers bans them on all your other
            Java servers, and on every server you create later. Unbanning only
            works per server, on its Players tab. Removing a name here stops
            future bans but keeps the existing ones.
          </p>
        </div>
        <BanForm
          busy={busy === "ban"}
          onBan={(name, reason) =>
            run("ban", async () => {
              setLists(await api.playerLists.ban(name, reason))
              toast.success(`${name} is banned on all your servers`)
            })
          }
        />
        {lists.bans.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nobody is banned.</p>
        ) : (
          <ul className="divide-y divide-border">
            {lists.bans.map((b) => (
              <li key={b.name} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm">{b.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {b.reason || "No reason"} ·{" "}
                    {new Date(
                      b.created_at.replace(" ", "T") + "Z"
                    ).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy !== null}
                  title="Stop banning on new servers; existing bans stay"
                  onClick={() =>
                    run(`unban-${b.name}`, async () => {
                      setLists(await api.playerLists.unbanGlobally(b.name))
                      toast.success(
                        `${b.name} is off the list. Unban them on each server where they should play again.`
                      )
                    })
                  }
                >
                  {busy === `unban-${b.name}` && (
                    <Loader2 className="size-3.5 animate-spin" />
                  )}
                  Remove from list
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function NameList({
  title,
  icon,
  names,
  busy,
  busyKey,
  onAdd,
  onRemove,
}: {
  title: string
  icon: React.ReactNode
  names: string[]
  busy: string | null
  busyKey: string
  onAdd: (name: string) => void
  onRemove: (name: string) => void
}) {
  const [name, setName] = useState("")
  const valid = NAME_RE.test(name.trim())
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-medium">
        {icon}
        {title}
        <span className="text-muted-foreground">({names.length})</span>
      </p>
      {names.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {names.map((n) => (
            <span
              key={n}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 py-0.5 pr-0.5 pl-2 font-mono text-xs"
            >
              {n}
              <button
                type="button"
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={`Remove ${n}`}
                disabled={busy !== null}
                onClick={() => onRemove(n)}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          onAdd(name.trim())
          setName("")
        }}
      >
        <Input
          className="h-8 font-mono text-xs"
          placeholder="Minecraft name"
          aria-label="Minecraft name"
          value={name}
          maxLength={16}
          onChange={(e) => setName(e.target.value)}
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={!valid || busy !== null}
        >
          {busy === busyKey ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Plus className="size-3.5" />
          )}
          Add
        </Button>
      </form>
    </div>
  )
}

function BanForm({
  busy,
  onBan,
}: {
  busy: boolean
  onBan: (name: string, reason?: string) => void
}) {
  const [name, setName] = useState("")
  const [reason, setReason] = useState("")
  const valid = NAME_RE.test(name.trim())
  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        onBan(name.trim(), reason.trim() || undefined)
        setName("")
        setReason("")
      }}
    >
      <Input
        className="h-8 w-40 font-mono text-xs"
        placeholder="Minecraft name"
        aria-label="Minecraft name to ban"
        value={name}
        maxLength={16}
        onChange={(e) => setName(e.target.value)}
      />
      <Input
        className="h-8 min-w-40 flex-1 text-xs"
        placeholder="Reason (optional)"
        aria-label="Ban reason (optional)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <Button
        type="submit"
        size="sm"
        variant="destructive"
        disabled={!valid || busy}
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Ban className="size-3.5" />
        )}
        Ban everywhere
      </Button>
    </form>
  )
}
