"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { CheckCircle2, Plus, Loader2, ServerOff, Settings2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import Link from "next/link"
import { TopNav } from "@/components/TopNav"
import { ServerCard } from "@/components/ServerCard"
import { TRANSITIONAL_STATES } from "@/components/ServerStateBadge"
import { ServerCreationProgress } from "@/components/ServerCreationProgress"
import { AuthPage, AuthStatusError } from "@/components/AuthPage"
import { SetupWizard } from "@/components/SetupWizard"
import { api } from "@/lib/api"
import { useAuth } from "@/hooks/useAuth"
import { useServerCreation } from "@/hooks/useServerCreation"
import { DELETING_KEY, normalizeServer } from "@/lib/utils"
import type { Server, ServerStats } from "@/lib/types"

const POLL_INTERVAL = 5000
// while a server is being created or deleted
const FAST_POLL_INTERVAL = 1500
// how long a deleted server's card stays at 100% before it's removed
const FINISH_MS = 900

type Setup = { completed: boolean; public_available: boolean }

// The last dashboard seen in this visit, so coming back to it shows the
// servers straight away (then refreshes) instead of loading from scratch.
let cache: {
  userId: number
  servers: Server[]
  stats: Record<number, ServerStats>
  setup: Setup | null
} | null = null

export default function DashboardPage() {
  const {
    loading: authLoading,
    statusError,
    setupRequired,
    authenticated,
    user,
    onLoginSuccess,
    retryStatus,
    logout,
  } = useAuth()

  const cached = cache && user && cache.userId === user.id ? cache : null
  const [servers, setServers] = useState<Server[]>(cached?.servers ?? [])
  const [statsMap, setStatsMap] = useState<Record<number, ServerStats>>(
    cached?.stats ?? {}
  )
  const [loading, setLoading] = useState(!cached)
  // null until loaded; the wizard runs after account creation until finished
  const [setup, setSetupState] = useState<Setup | null>(cached?.setup ?? null)

  // keep the cache in step with what's on screen
  const userId = user?.id
  useEffect(() => {
    if (userId == null || loading) return
    cache = { userId, servers, stats: statsMap, setup }
  }, [userId, loading, servers, statsMap, setup])

  const loadSetup = useCallback(async () => {
    try {
      setSetupState(await api.setup.get())
    } catch {
      // older API without setup support: behave as before
      setSetupState({ completed: true, public_available: true })
    }
  }, [])

  useEffect(() => {
    if (authenticated) loadSetup()
  }, [authenticated, loadSetup])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Servers being deleted (last seen card, or just the name when the
  // deletion was started on the server page). Once one is gone from the
  // list, its card runs to 100% and a confirmation is shown.
  const deletingRef = useRef<Map<number, { name: string; card?: Server }>>(
    new Map()
  )
  const [finishing, setFinishing] = useState<Server[]>([])
  const [deletedNames, setDeletedNames] = useState<string[]>([])

  const trackDeletions = useCallback((list: Server[]) => {
    const tracked = deletingRef.current
    const handoff = sessionStorage.getItem(DELETING_KEY)
    if (handoff) {
      sessionStorage.removeItem(DELETING_KEY)
      try {
        const { id, name } = JSON.parse(handoff)
        if (!tracked.has(id)) tracked.set(id, { name })
      } catch {
        // ignore a malformed entry
      }
    }

    const present = new Set(list.map((s) => s.id))
    const done = [...tracked.entries()].filter(([id]) => !present.has(id))
    for (const s of list) {
      if (
        s.progress?.action === "delete" &&
        s.progress.status === "in_progress"
      )
        tracked.set(s.id, { name: s.name, card: s })
      else if (s.progress?.status === "failed") tracked.delete(s.id)
    }
    if (!done.length) return

    for (const [id] of done) tracked.delete(id)
    const cards: Server[] = done.flatMap(([, d]) =>
      d.card
        ? [
            {
              ...d.card,
              progress: { ...d.card.progress!, percent: 100, step: "Deleted" },
            },
          ]
        : []
    )
    setFinishing((prev) => [...prev, ...cards])
    setTimeout(
      () => {
        setFinishing((prev) => prev.filter((c) => !cards.includes(c)))
        setDeletedNames((prev) => [...prev, ...done.map(([, d]) => d.name)])
      },
      cards.length ? FINISH_MS : 0
    )
  }, [])

  const fetchServers = useCallback(async () => {
    try {
      const res = await api.servers.list()
      const list: Server[] = (res?.servers ?? res?.data ?? res ?? []).map(
        normalizeServer
      )
      setServers(list)
      trackDeletions(list)
      // fetch stats in parallel
      const statsEntries = await Promise.allSettled(
        list.map((s) =>
          api.servers
            .stats(s.id)
            .then((r) => [s.id, r?.data ?? r] as [number, ServerStats])
        )
      )
      const next: Record<number, ServerStats> = {}
      for (const result of statsEntries) {
        if (result.status === "fulfilled") {
          const [id, stats] = result.value
          next[id] = stats
        }
      }
      setStatsMap(next)
    } catch {
      // silently fail on poll
    } finally {
      setLoading(false)
    }
  }, [trackDeletions])

  const { task: creationTask, dismiss: dismissCreation } =
    useServerCreation(fetchServers)

  const anyBusy =
    finishing.length > 0 ||
    servers.some((s) => s.progress?.status === "in_progress") ||
    Object.values(statsMap).some(
      (stats) => stats.state && TRANSITIONAL_STATES.includes(stats.state)
    )

  useEffect(() => {
    if (!authenticated) return
    fetchServers()
    intervalRef.current = setInterval(
      fetchServers,
      anyBusy ? FAST_POLL_INTERVAL : POLL_INTERVAL
    )
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchServers, authenticated, anyBusy])

  // a finished creation stays in the notification for a few seconds
  useEffect(() => {
    if (creationTask?.stage !== "ready") return
    const t = setTimeout(dismissCreation, 5000)
    return () => clearTimeout(t)
  }, [creationTask?.stage, dismissCreation])

  // Show a full-screen spinner while checking auth
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (statusError) {
    return <AuthStatusError message={statusError} onRetry={retryStatus} />
  }

  // Show auth page when setup is required or user is not authenticated
  if (setupRequired || !authenticated) {
    return (
      <AuthPage
        initialView={setupRequired ? "setup-form" : "login-form"}
        onLoginSuccess={onLoginSuccess}
      />
    )
  }

  if (!setup) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // first run: the setup wizard; later changes happen on /settings
  // only an admin can finish the first-run setup
  if (!setup.completed && user?.is_admin) {
    return (
      <div className="min-h-screen bg-background">
        <TopNav user={user} onLogout={logout} />
        <SetupWizard firstRun onDone={loadSetup} />
      </div>
    )
  }

  const cards = [
    ...servers,
    ...finishing.filter((f) => !servers.some((s) => s.id === f.id)),
  ].sort((a, b) => a.id - b.id)

  return (
    <div className="min-h-screen bg-background">
      <TopNav user={user} onLogout={logout} />

      <main className="page-content mx-auto max-w-screen-xl px-6 py-8 [--page-name:page-servers] modern:pt-10">
        {/* Page header */}
        <div className="enter mb-8 flex items-center justify-between modern:mb-7 modern:items-end">
          <div>
            <h1 className="text-xl font-semibold modern:text-[32px] modern:leading-tight modern:font-bold">
              Servers
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {loading
                ? "Loading…"
                : `${cards.length} server${cards.length !== 1 ? "s" : ""}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {user?.is_admin && (
              <Button variant="outline" asChild>
                <Link href="/servers/defaults">
                  <Settings2 className="size-4" />
                  Defaults
                </Link>
              </Button>
            )}
            <Button asChild>
              <Link href="/servers/new">
                <Plus className="size-4" />
                New Server
              </Link>
            </Button>
          </div>
        </div>

        {/* Server grid */}
        {loading ? (
          <>
            <div className="flex h-48 items-center justify-center modern:hidden">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
            {/* modern: placeholder cards in the shape of the real ones */}
            <div
              aria-hidden
              className="hidden gap-4 sm:grid-cols-2 lg:grid-cols-3 modern:grid"
            >
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-surface"
                >
                  <div className="flex items-center gap-3">
                    <div className="skeleton size-12 rounded-[12px]" />
                    <div className="flex-1 space-y-2">
                      <div className="skeleton h-3.5 w-2/3" />
                      <div className="skeleton h-3 w-1/3" />
                    </div>
                  </div>
                  <div className="skeleton h-3 w-1/2" />
                  <div className="skeleton h-8 rounded-[10px]" />
                  <div className="skeleton h-7 rounded-full" />
                </div>
              ))}
            </div>
          </>
        ) : cards.length === 0 ? (
          <div className="enter flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
            <ServerOff className="size-10 opacity-40" />
            <p className="text-sm">No servers yet.</p>
            <Button variant="outline" asChild>
              <Link href="/servers/new">
                <Plus className="size-4" />
                Create your first server
              </Link>
            </Button>
          </div>
        ) : (
          <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 modern:gap-4 modern:xl:grid-cols-3">
            {cards.map((server) => (
              <ServerCard
                key={server.id}
                server={server}
                stats={statsMap[server.id] ?? null}
                onRefresh={fetchServers}
                viewerId={user?.id}
              />
            ))}
          </div>
        )}
      </main>

      {/* Confirms finished deletions, one at a time */}
      <Dialog open={deletedNames.length > 0}>
        <DialogContent className="sm:max-w-sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-emerald-500" />
              Server deleted
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {deletedNames[0]}
            </span>{" "}
            was successfully deleted.
          </p>
          <DialogFooter>
            <Button onClick={() => setDeletedNames((prev) => prev.slice(1))}>
              Acknowledged
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Floating progress — a server started on /servers/new keeps
          reporting here */}
      {creationTask && (
        <ServerCreationProgress
          task={creationTask}
          onDismiss={dismissCreation}
        />
      )}
    </div>
  )
}
