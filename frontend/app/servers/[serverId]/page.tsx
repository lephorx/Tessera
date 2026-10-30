"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useParams, useSearchParams, notFound } from "next/navigation"
import Link from "next/link"
import {
  Activity,
  Archive,
  ArrowLeft,
  FolderOpen,
  Hash,
  Link2,
  Loader2,
  Pencil,
  Play,
  RotateCw,
  Settings2,
  Skull,
  SlidersHorizontal,
  Square,
  RefreshCw,
  Terminal,
  TriangleAlert,
  Trash2,
  Users,
} from "lucide-react"
import { toast } from "sonner"

import { TopNav } from "@/components/TopNav"
import { Console } from "@/components/Console"
import { FileExplorer } from "@/components/FileExplorer"
import { ServerStats } from "@/components/ServerStats"
import { PropertiesPanel } from "@/components/PropertiesPanel"
import { PlayersPanel } from "@/components/PlayersPanel"
import { BackupsPanel } from "@/components/BackupsPanel"
import { AuthPage, AuthStatusError } from "@/components/AuthPage"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Switch } from "@/components/ui/switch"
import { Progress } from "@/components/ui/progress"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { VersionPicker } from "@/components/VersionPicker"
import { CopyButton } from "@/components/CopyButton"
import { AppearancePanel } from "@/components/AppearancePanel"
import { ServerIcon } from "@/components/ServerIcon"
import { StatCards } from "@/components/StatCards"
import { serverTypeInfo } from "@/components/Chip"
import {
  ServerStateBadge,
  TRANSITIONAL_STATES,
  serverState,
} from "@/components/ServerStateBadge"
import { api } from "@/lib/api"
import { useAuth } from "@/hooks/useAuth"
import {
  cn,
  DELETING_KEY,
  normalizeServer,
  serverConnectAddress,
} from "@/lib/utils"
import { useSmoothPercent } from "@/hooks/useSmoothPercent"
import type { Server, ServerProgress, ServerStats as Stats } from "@/lib/types"

const POLL_INTERVAL = 5000
const FAST_POLL_INTERVAL = 1500

// Servers seen in this visit, so reopening one shows it straight away
// (then refreshes) instead of the loading skeleton.
const seen = new Map<number, { server: Server; stats: Stats | null }>()

export default function ServerDetailPage() {
  const params = useParams()
  const serverId = Number(params?.serverId)

  const {
    loading: authLoading,
    setupRequired,
    authenticated,
    user,
    onLoginSuccess,
    retryStatus,
    statusError,
    logout,
  } = useAuth()

  const [server, setServer] = useState<Server | null>(
    () => seen.get(serverId)?.server ?? null
  )
  const [stats, setStats] = useState<Stats | null>(
    () => seen.get(serverId)?.stats ?? null
  )
  const [loadingServer, setLoadingServer] = useState(() => !seen.has(serverId))
  useEffect(() => {
    if (server && server.id === serverId) seen.set(serverId, { server, stats })
  }, [server, stats, serverId])
  const [loadingAction, setLoadingAction] = useState<
    "start" | "stop" | "restart" | "kill" | null
  >(null)
  const [confirmAction, setConfirmAction] = useState<"stop" | "kill" | null>(
    null
  )
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [tunneling, setTunneling] = useState(false)
  // latest polled setup / tunnel progress while one runs
  const [liveProgress, setLiveProgress] = useState<ServerProgress | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  // admins: give the server to another user
  const [ownerUsers, setOwnerUsers] = useState<
    { id: number; username: string }[] | null
  >(null)
  const [ownerChoice, setOwnerChoice] = useState("")
  const [ownerSaving, setOwnerSaving] = useState(false)
  const [renameValue, setRenameValue] = useState("")
  const [renaming, setRenaming] = useState(false)

  // Settings edit state
  type EditField = "name" | "port" | "ram" | "version" | null
  const [editField, setEditField] = useState<EditField>(null)
  const [editValues, setEditValues] = useState({
    name: "",
    port: "",
    mem_min: "",
    mem_max: "",
    version: "",
    loader_version: "",
  })
  const [editSaving, setEditSaving] = useState(false)
  const [portError, setPortError] = useState("")

  // Bedrock-only: allow-cheats toggle
  const [cheatsEnabled, setCheatsEnabled] = useState<boolean | null>(null)
  const [cheatsConfirmOpen, setCheatsConfirmOpen] = useState(false)
  const [cheatsSaving, setCheatsSaving] = useState(false)

  // Recreate container (rebuild from current DB config, no settings change)
  const [recreateConfirmOpen, setRecreateConfirmOpen] = useState(false)
  const [recreating, setRecreating] = useState(false)
  const [recreateStep, setRecreateStep] = useState("")
  const [recreateBackup, setRecreateBackup] = useState(true)

  const searchParams = useSearchParams()
  const VALID_TABS = [
    "console",
    "files",
    "stats",
    "players",
    "properties",
    "backups",
    "settings",
  ] as const
  type Tab = (typeof VALID_TABS)[number]
  const rawTab = searchParams.get("tab") ?? ""
  // kept here (not read back from the URL) so a switch renders right away,
  // inside the tab transition; the URL follows along
  const [activeTab, setActiveTab] = useState<Tab>(() =>
    (VALID_TABS as readonly string[]).includes(rawTab)
      ? (rawTab as Tab)
      : "console"
  )

  function setTab(tab: Tab) {
    setActiveTab(tab)
    const params = new URLSearchParams(window.location.search)
    params.set("tab", tab)
    window.history.replaceState(null, "", `?${params.toString()}`)
  }

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStats = useCallback(async () => {
    try {
      const res = await api.servers.stats(serverId)
      setStats(res?.data ?? res)
    } catch {
      // ignore poll errors
    }
  }, [serverId])

  useEffect(() => {
    if (isNaN(serverId) || !authenticated) return

    // Load this server's metadata
    api.servers
      .get(serverId)
      .then((res) => {
        const found: Server | undefined = res?.server ?? res?.data ?? res
        if (!found) return notFound()
        const normalized = normalizeServer(found)
        setServer(normalized)
        if (normalized.type === "bedrock") {
          api.bedrock
            .getProperties(serverId)
            .then((r) =>
              setCheatsEnabled(r?.properties?.["allow-cheats"] === "true")
            )
            .catch(() => {})
        }
      })
      .catch(() => toast.error("Failed to load server"))
      .finally(() => setLoadingServer(false))
  }, [serverId, authenticated])

  const isRunning = stats?.running ?? false
  const state = serverState(stats, loadingAction)
  // follow starting / stopping closely so the badge flips right away
  const transitional = state !== null && TRANSITIONAL_STATES.includes(state)

  useEffect(() => {
    if (isNaN(serverId) || !authenticated) return
    fetchStats()
    intervalRef.current = setInterval(
      fetchStats,
      transitional ? FAST_POLL_INTERVAL : POLL_INTERVAL
    )
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [serverId, authenticated, fetchStats, transitional])

  // Follow tunnel creation (and the setup of a new server) step by step.
  const watching =
    tunneling ||
    liveProgress?.status === "in_progress" ||
    server?.progress?.status === "in_progress"
  useEffect(() => {
    if (!watching) return
    const id = setInterval(async () => {
      try {
        const p = await api.servers.progress(serverId)
        if (p?.status === "in_progress") {
          setLiveProgress(p)
          return
        }
        if (p?.action === "delete" && p.status !== "failed") {
          // gone: the dashboard confirms the deletion
          sessionStorage.setItem(
            DELETING_KEY,
            JSON.stringify({ id: serverId, name: serverName.current })
          )
          window.location.href = "/servers"
          return
        }
        if (p?.action === "delete" && p.status === "failed")
          toast.error(p.message ?? "The server could not be deleted")
        setLiveProgress(null)
        setTunneling(false)
        if (p?.action === "tunnel" && p.status === "completed")
          toast.success(p.message ?? p.step ?? "Public address ready")
        if (p?.action === "tunnel" && p.status === "failed")
          toast.error(p.message ?? "Tunnel creation failed")
        const res = await api.servers.get(serverId)
        const found: Server | undefined = res?.server ?? res?.data ?? res
        if (found) setServer(normalizeServer(found))
      } catch {
        // keep polling
      }
    }, 1500)
    return () => clearInterval(id)
  }, [watching, serverId])

  // progress for the full-page overlay (hooks must run before early returns)
  const pageProgress = liveProgress ?? server?.progress ?? null
  const pageBusy =
    pageProgress?.status === "in_progress" &&
    (pageProgress.action === "delete" || pageProgress.action === "provision")
  const overlayPercent = useSmoothPercent(pageProgress?.percent ?? 0, pageBusy)
  // remembered for the dashboard's "was deleted" message
  const serverName = useRef("The server")
  if (server?.name) serverName.current = server.name

  async function execAction(action: "start" | "stop" | "restart" | "kill") {
    setLoadingAction(action)
    try {
      if (action === "start") await api.control.start(serverId)
      else if (action === "stop") await api.control.stop(serverId)
      else if (action === "restart") await api.control.restart(serverId)
      else await api.control.kill(serverId)

      toast.success(
        action === "start"
          ? "Server started"
          : action === "stop"
            ? "Server stopped"
            : action === "restart"
              ? "Server restarting"
              : "Server killed"
      )
      fetchStats()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : `Failed to ${action} server`
      )
    } finally {
      setLoadingAction(null)
    }
  }

  async function handleDelete() {
    setDeleteOpen(false)
    // the deletion overlay takes over right away and follows the progress
    setLiveProgress({
      action: "delete",
      status: "in_progress",
      percent: 2,
      step: "Deletion queued",
      message: null,
    })
    try {
      await api.servers.delete(serverId)
    } catch (err) {
      setLiveProgress(null)
      toast.error(
        err instanceof Error ? err.message : "Failed to delete server"
      )
    }
  }

  async function refreshServerMeta() {
    const res = await api.servers.get(serverId)
    const found: Server | undefined = res?.server ?? res?.data ?? res
    if (found) setServer(normalizeServer(found))
  }

  async function handleRecreate() {
    setRecreateConfirmOpen(false)
    setRecreating(true)
    try {
      if (recreateBackup) {
        setRecreateStep("Backing up server…")
        await api.backups.create(serverId, "zip")
      }

      setRecreateStep("Rebuilding container…")
      await api.control.recreate(serverId)

      toast.success("Server recreated — container rebuilt from current config")
      await refreshServerMeta()
      fetchStats()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to recreate server"
      )
    } finally {
      setRecreating(false)
      setRecreateStep("")
    }
  }

  async function handleToggleCheats() {
    const next = !cheatsEnabled
    setCheatsConfirmOpen(false)
    setCheatsSaving(true)
    try {
      await api.bedrock.setCheats(serverId, next)
      setCheatsEnabled(next)
      toast.success(
        `Cheats ${next ? "enabled" : "disabled"} — server restarted`
      )
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to change cheats setting"
      )
    } finally {
      setCheatsSaving(false)
    }
  }

  async function handleSetupTunnel() {
    setTunneling(true)
    setLiveProgress({
      action: "tunnel",
      status: "in_progress",
      percent: 2,
      step: "Starting tunnel creation",
      message: null,
    })
    try {
      // starts in the background; the effect above follows the progress
      await api.control.tunnel(serverId)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to set up tunnel"
      )
      setTunneling(false)
      setLiveProgress(null)
    }
  }

  async function openOwnerDialog() {
    try {
      const res = await api.users.list()
      setOwnerChoice(String(server?.owner?.id ?? ""))
      setOwnerUsers(res.users)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load users")
    }
  }

  async function handleChangeOwner(e: React.FormEvent) {
    e.preventDefault()
    setOwnerSaving(true)
    try {
      await api.control.setOwner(serverId, Number(ownerChoice))
      toast.success("Owner changed")
      setOwnerUsers(null)
      await refreshServerMeta()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change owner")
    } finally {
      setOwnerSaving(false)
    }
  }

  async function handleRetryDns() {
    if (!server) return
    setRenaming(true)
    try {
      const result = (await api.control.subdomain(serverId, server.slug)) as {
        warning?: string
      }
      toast.success(result.warning ?? "Custom address ready")
      await refreshServerMeta()
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to set up the custom address"
      )
      await refreshServerMeta()
    } finally {
      setRenaming(false)
    }
  }

  async function handleRenameSubdomain(e: React.FormEvent) {
    e.preventDefault()
    if (!renameValue.trim()) return
    setRenaming(true)
    try {
      const result = (await api.control.subdomain(
        serverId,
        renameValue.trim()
      )) as { warning?: string }
      toast.success(result.warning ?? "Custom address updated")
      setRenameOpen(false)
      await refreshServerMeta()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update address"
      )
    } finally {
      setRenaming(false)
    }
  }

  function openEdit(field: "name" | "port" | "ram" | "version") {
    if (!server) return
    setPortError("")
    if (field === "name") setEditValues((v) => ({ ...v, name: server.name }))
    if (field === "port")
      setEditValues((v) => ({ ...v, port: String(server.port ?? "") }))
    if (field === "ram")
      setEditValues((v) => ({
        ...v,
        mem_min: String(server.mem_min ?? 2),
        mem_max: String(server.mem_max ?? 4),
      }))
    if (field === "version")
      setEditValues((v) => ({
        ...v,
        version: server.version,
        loader_version: server.loader_version ?? "",
      }))
    setEditField(field)
  }

  async function handleEditSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editField || !server) return
    setEditSaving(true)
    try {
      if (editField === "name") {
        const name = editValues.name.trim()
        if (!name) {
          toast.error("Name cannot be empty")
          return
        }
        await api.control.rename(serverId, name)
        toast.success("Server renamed")
      } else if (editField === "port") {
        const port = parseInt(editValues.port, 10)
        if (isNaN(port) || port < 1024 || port > 65535) {
          setPortError("Port must be between 1024 and 65535")
          return
        }
        await api.control.changePort(serverId, port)
        toast.success("Port updated")
      } else if (editField === "ram") {
        const isBedrock = server.type === "bedrock"
        const min = parseInt(editValues.mem_min, 10)
        const max = parseInt(editValues.mem_max, 10)
        if (
          (!isBedrock && (isNaN(min) || min < 1)) ||
          isNaN(max) ||
          max < (isBedrock ? 1 : min)
        ) {
          toast.error("Invalid RAM values")
          return
        }
        await api.control.changeRam(serverId, isBedrock ? max : min, max)
        toast.success("RAM updated")
      } else if (editField === "version") {
        const version = editValues.version.trim()
        if (!version) {
          toast.error("Version cannot be empty")
          return
        }
        const loader_version = editValues.loader_version.trim() || null
        await api.control.changeVersion(serverId, version, loader_version)
        toast.success("Version updated — server is being recreated")
      }
      setEditField(null)
      await refreshServerMeta()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setEditSaving(false)
    }
  }

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

  if (setupRequired || !authenticated) {
    return (
      <AuthPage
        initialView={setupRequired ? "setup-form" : "login-form"}
        onLoginSuccess={onLoginSuccess}
      />
    )
  }

  if (loadingServer) {
    return (
      <>
        <div className="flex min-h-screen items-center justify-center bg-background modern:hidden">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
        {/* modern: the page's shape while the server loads */}
        <div className="hidden min-h-screen bg-background modern:block">
          <TopNav user={user} onLogout={logout} />
          <div
            aria-hidden
            className="page-content mx-auto w-full max-w-screen-xl px-6 py-8 [--page-name:page-server]"
          >
            <div className="skeleton mb-5 h-4 w-24" />
            <div className="flex items-center gap-4">
              <div className="skeleton size-16 rounded-[15px]" />
              <div className="flex-1 space-y-2.5">
                <div className="skeleton h-7 w-64" />
                <div className="skeleton h-4 w-80" />
              </div>
            </div>
            <div className="skeleton mt-8 h-24 rounded-[16px]" />
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton h-[104px] rounded-[16px]" />
              ))}
            </div>
            <div className="skeleton mt-5 h-11 w-[560px] max-w-full rounded-[16px]" />
            <div className="skeleton mt-3 h-[420px] rounded-[16px]" />
          </div>
        </div>
      </>
    )
  }

  if (!server) return null

  const progress = liveProgress ?? server.progress ?? null
  const setupProgress = progress?.status === "in_progress" &&
    progress.action !== "delete" && (
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center justify-between gap-3 text-[11px]">
          <span className="flex min-w-0 items-center gap-1.5 text-foreground">
            <Loader2 className="size-3 shrink-0 animate-spin" />
            <span className="truncate">{progress.step ?? "Working…"}</span>
          </span>
          <span className="shrink-0 tabular-nums">{progress.percent}%</span>
        </div>
        <Progress value={progress.percent} className="h-1" />
      </div>
    )

  const isDeleting = pageBusy && pageProgress?.action === "delete"

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TopNav user={user} onLogout={logout} />

      {/* Deletion / creation in progress: covers the page and can't be closed */}
      {pageBusy && pageProgress && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label={
            isDeleting
              ? "Server deletion in progress"
              : "Server creation in progress"
          }
          className={`fixed inset-0 z-50 flex items-center justify-center p-6 backdrop-blur-sm ${
            isDeleting ? "bg-destructive/25" : "bg-primary/15"
          }`}
        >
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 text-center shadow-xl">
            <div className="flex items-center justify-center gap-2">
              {isDeleting ? (
                <Trash2 className="size-5 text-destructive" />
              ) : (
                <Loader2 className="size-5 animate-spin text-primary" />
              )}
              <h2 className="text-base font-semibold">
                {isDeleting
                  ? "Server deletion in progress"
                  : "Server creation in progress"}
              </h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{server.name}</p>
            <Progress
              value={overlayPercent}
              className={`mt-5 h-1.5 ${isDeleting ? "[&>div]:bg-destructive" : ""}`}
            />
            <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span className="flex min-w-0 items-center gap-1.5">
                <Loader2 className="size-3 shrink-0 animate-spin" />
                <span className="truncate">
                  {pageProgress.step ?? "Working…"}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">{overlayPercent}%</span>
            </div>
            <p className="mt-4 text-[11px] text-muted-foreground">
              {isDeleting
                ? "You'll be taken back to your servers when it's done."
                : "This page unlocks when the server is ready."}
            </p>
            {/* the dashboard keeps showing the progress on the server's card */}
            <Button asChild variant="outline" size="sm" className="mt-4">
              <Link href="/servers">
                <ArrowLeft className="size-3.5" />
                Back to dashboard
              </Link>
            </Button>
          </div>
        </div>
      )}

      <main
        className="page-content enter mx-auto w-full max-w-screen-xl flex-1 px-6 py-8 [--page-name:page-server]"
        inert={pageBusy || undefined}
      >
        {/* Breadcrumb + header */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Link
              href="/servers"
              className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground modern:mb-3 modern:w-fit modern:text-[13px] modern:font-medium modern:text-tint modern:hover:text-tint/80"
            >
              <ArrowLeft className="size-3 modern:size-3.5" />
              All Servers
            </Link>
            <div className="flex items-center gap-3 modern:gap-4">
              <ServerIcon
                serverId={server.id}
                iconVersion={server.icon_version}
                className="modern:size-16 modern:rounded-[15px]"
              />
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-xl font-semibold modern:text-[28px] modern:leading-tight modern:font-extrabold">
                    {server.name}
                  </h1>
                  <ServerStateBadge state={state} />
                </div>
                {/* modern: what it is and where to find it, with icons */}
                <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-medium text-muted-foreground modern:flex">
                  {(() => {
                    const type = serverTypeInfo(server.type)
                    return (
                      <span className="flex items-center gap-1.5">
                        <type.icon
                          className="size-3.5 text-[color-mix(in_srgb,var(--chip)_55%,black)] dark:text-(--chip)"
                          style={
                            { "--chip": type.color } as React.CSSProperties
                          }
                        />
                        {type.label}{" "}
                        {server.version === "LATEST"
                          ? "Latest"
                          : server.version}
                        {server.loader_version
                          ? ` · ${server.loader_version}`
                          : ""}
                      </span>
                    )
                  })()}
                  {serverConnectAddress(server) && (
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span aria-hidden className="text-border">
                        •
                      </span>
                      <Link2 className="size-3.5" />
                      <span className="truncate">
                        {serverConnectAddress(server)}
                      </span>
                    </span>
                  )}
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className="text-border">
                      •
                    </span>
                    <Hash className="size-3.5" />
                    <span className="tabular-nums">{server.port}</span>
                  </span>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground capitalize modern:hidden">
              {server.type} · {server.version}
              {server.loader_version ? ` / ${server.loader_version}` : ""} · :
              {server.port}
            </p>
            {server.owner && user?.is_admin && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Owner: {server.owner.username}
                {user?.is_admin && (
                  <button
                    type="button"
                    onClick={openOwnerDialog}
                    className="ml-2 underline underline-offset-4 hover:text-foreground"
                  >
                    Change
                  </button>
                )}
              </p>
            )}
          </div>

          {/* Control buttons */}
          {/* modern: filled like a hosting panel, only the start or stop
              that applies; kill and delete stay quiet */}
          <div className="flex flex-wrap items-center gap-2 modern:self-end">
            <Button
              size="sm"
              className={cn(
                "bg-emerald-600 text-white hover:bg-emerald-700",
                "modern:h-9 modern:bg-fill-green modern:px-4 modern:text-on-fill modern:hover:bg-fill-green",
                isRunning && "modern:hidden"
              )}
              disabled={isRunning || loadingAction !== null}
              onClick={() => execAction("start")}
            >
              {loadingAction === "start" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Play className="hidden size-3.5 modern:block" />
              )}
              Start
            </Button>
            <Button
              size="sm"
              className={cn(
                "bg-amber-500 text-white hover:bg-amber-600",
                "modern:order-2 modern:h-9 modern:bg-fill-red modern:px-4 modern:text-on-fill modern:hover:bg-fill-red",
                !isRunning && "modern:hidden"
              )}
              disabled={!isRunning || loadingAction !== null}
              onClick={() => setConfirmAction("stop")}
            >
              {loadingAction === "stop" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Square className="hidden size-3.5 modern:block" />
              )}
              Stop
            </Button>
            <Button
              size="sm"
              className="bg-blue-600 text-white hover:bg-blue-700 modern:order-1 modern:h-9 modern:bg-fill-orange modern:px-4 modern:text-on-fill modern:hover:bg-fill-orange"
              disabled={!isRunning || loadingAction !== null}
              onClick={() => execAction("restart")}
            >
              {loadingAction === "restart" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RotateCw className="hidden size-3.5 modern:block" />
              )}
              Restart
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="modern:order-3 modern:h-9 modern:bg-fill modern:px-3.5 modern:hover:bg-destructive/15"
              disabled={loadingAction !== null}
              onClick={() => setConfirmAction("kill")}
            >
              {loadingAction === "kill" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Skull className="hidden size-3.5 modern:block" />
              )}
              Kill
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-destructive text-destructive hover:bg-destructive/10 modern:order-4 modern:h-9 modern:px-3.5 modern:text-destructive modern:hover:bg-destructive/15"
              onClick={() => setDeleteOpen(true)}
              aria-label="Delete server"
            >
              <Trash2 className="hidden size-3.5 modern:block" />
              Delete
            </Button>
          </div>
        </div>

        {/* Playit address */}
        {server.local_only ? (
          <div className="mb-6 flex items-center justify-between gap-4 border border-border bg-muted/40 px-4 py-3 modern:bg-card">
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                Local address:{" "}
              </span>
              {typeof window !== "undefined" ? window.location.hostname : "—"}:
              {server.port}
              <p className="mt-1 text-[11px]">
                Reachable from your local network. Set up a Playit tunnel for
                public access.
              </p>
              {setupProgress}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSetupTunnel}
              disabled={tunneling}
            >
              {tunneling && <Loader2 className="size-3.5 animate-spin" />}
              {tunneling ? "Creating tunnel…" : "Set up Playit tunnel"}
            </Button>
          </div>
        ) : server.tunnels.length > 0 ? (
          <div className="mb-6 border border-border bg-muted/40 text-xs text-muted-foreground modern:bg-card">
            <div className="flex items-center justify-between gap-4 px-4 py-3 modern:flex-wrap modern:gap-y-2">
              <div>
                <span className="inline-flex items-center gap-1">
                  <span className="font-medium text-foreground">
                    {server.type === "bedrock" ? "Address: " : "Connect: "}
                  </span>
                  {serverConnectAddress(server)}
                  <CopyButton value={serverConnectAddress(server) ?? ""} />
                </span>
                {server.dns_records.some(
                  (record) => record.type === "CNAME"
                ) && (
                  <p className="mt-1 flex items-center gap-1 text-[11px]">
                    Playit address: {server.tunnels[0].address}
                    <CopyButton
                      value={server.tunnels[0].address}
                      label="Copy Playit address"
                      className="size-5"
                    />
                  </p>
                )}
                {server.type === "bedrock" && (
                  <>
                    <span className="ml-4 font-medium text-foreground">
                      Port:{" "}
                    </span>
                    {server.tunnels[0].external_port ?? "See Playit dashboard"}
                    {server.tunnels[0].external_port && (
                      <CopyButton
                        value={String(server.tunnels[0].external_port)}
                        label="Copy port"
                        className="ml-1 align-middle"
                      />
                    )}
                    <p className="mt-1 text-[11px]">
                      Enter the address and port separately in Bedrock.
                    </p>
                  </>
                )}
              </div>
              {server.cloudflare_available && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setRenameValue(
                      server.dns_records
                        .find((record) => record.type === "CNAME")
                        ?.name.split(".")[0] ?? server.slug
                    )
                    setRenameOpen(true)
                  }}
                >
                  <Pencil className="size-3.5" />{" "}
                  {server.dns_records.some((record) => record.type === "CNAME")
                    ? "Rename"
                    : "Add custom address"}
                </Button>
              )}
            </div>
            {/* Why there is no custom Cloudflare address */}
            {!server.dns_records.some((record) => record.type === "CNAME") && (
              <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-2.5 modern:flex-wrap modern:gap-y-2 modern:border-separator">
                <p className="flex items-start gap-2 text-[11px]">
                  {server.cloudflare_available && server.dns_error && (
                    <TriangleAlert className="mt-px size-3.5 shrink-0 text-amber-500" />
                  )}
                  <span>
                    <span className="font-medium text-foreground">
                      No custom address:{" "}
                    </span>
                    {!server.cloudflare_available
                      ? "Cloudflare isn't set up, so players use the Playit address."
                      : (server.dns_error ??
                        "This server has no Cloudflare DNS record yet.")}
                  </span>
                </p>
                {server.cloudflare_available ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRetryDns}
                    disabled={renaming}
                  >
                    {renaming && <Loader2 className="size-3.5 animate-spin" />}
                    {server.dns_error ? "Retry" : "Create"}
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" asChild>
                    <Link href="/settings">Set up Cloudflare</Link>
                  </Button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="mb-6 flex items-center justify-between gap-4 border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-muted-foreground modern:rounded-xl modern:border-status-orange/30 modern:bg-status-orange/10">
            <div className="flex flex-1 items-start gap-2">
              <TriangleAlert className="mt-px size-4 shrink-0 text-amber-500" />
              <span className="flex-1">
                <span className="block font-medium text-foreground">
                  No public address
                </span>
                {setupProgress
                  ? "The Playit tunnel is being created. This takes a minute or two."
                  : !server.playit_configured
                    ? "Playit isn't set up, so Tessera can't create a tunnel. Add your Playit account in Connection settings."
                    : (server.tunnel_error ??
                      "This server has no Playit tunnel. If it was just created, the tunnel may still be in progress.")}
                <span className="mt-1 block text-[11px]">
                  Players on your network can still join at{" "}
                  {typeof window !== "undefined"
                    ? window.location.hostname
                    : "—"}
                  :{server.port}.
                </span>
                {setupProgress}
              </span>
            </div>
            <div className="flex shrink-0 gap-2">
              {server.playit_configured && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSetupTunnel}
                  disabled={tunneling}
                >
                  {tunneling && <Loader2 className="size-3.5 animate-spin" />}
                  {tunneling ? "Creating tunnel…" : "Retry Playit tunnel"}
                </Button>
              )}
              <Button
                size="sm"
                variant={server.playit_configured ? "ghost" : "outline"}
                asChild
              >
                <Link href="/settings">Connection settings</Link>
              </Button>
            </div>
          </div>
        )}

        {/* modern: live numbers, like a hosting panel's overview */}
        <div className="mb-5 hidden modern:block">
          <StatCards stats={stats} />
        </div>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setTab(v as Tab)}
          className="flex flex-col gap-0"
        >
          <TabsList
            variant="line"
            className="mb-0 w-full justify-start border-b border-border pb-0"
          >
            <TabsTrigger value="console">
              <Terminal className="hidden size-4 modern:block" />
              Console
            </TabsTrigger>
            <TabsTrigger value="files">
              <FolderOpen className="hidden size-4 modern:block" />
              Files
            </TabsTrigger>
            <TabsTrigger value="stats">
              <Activity className="hidden size-4 modern:block" />
              Stats
            </TabsTrigger>
            <TabsTrigger value="players">
              <Users className="hidden size-4 modern:block" />
              Players
            </TabsTrigger>
            <TabsTrigger value="properties">
              <SlidersHorizontal className="hidden size-4 modern:block" />
              Properties
            </TabsTrigger>
            <TabsTrigger value="backups">
              <Archive className="hidden size-4 modern:block" />
              Backups
            </TabsTrigger>
            <TabsTrigger value="settings">
              <Settings2 className="size-3.5 modern:size-4" />
              Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="console"
            className="panel mt-0 border border-t-0 border-border modern:mt-3 modern:overflow-hidden modern:rounded-[16px] modern:border-t modern:bg-card modern:shadow-surface"
          >
            <Console serverId={serverId} isRunning={isRunning} />
          </TabsContent>

          <TabsContent
            value="files"
            className="panel mt-0 border border-t-0 border-border modern:mt-3 modern:overflow-hidden modern:rounded-[16px] modern:border-t modern:bg-card modern:shadow-surface"
            style={{ minHeight: "480px" }}
          >
            <FileExplorer serverId={serverId} />
          </TabsContent>

          <TabsContent
            value="stats"
            className="panel mt-0 border border-t-0 border-border modern:mt-3 modern:overflow-hidden modern:rounded-[16px] modern:border-t modern:bg-card modern:shadow-surface"
          >
            <ServerStats stats={stats} loading={loadingServer} />
          </TabsContent>

          <TabsContent
            value="players"
            className="panel mt-0 border border-t-0 border-border modern:mt-3 modern:overflow-hidden modern:rounded-[16px] modern:border-t modern:bg-card modern:shadow-surface"
          >
            <PlayersPanel
              serverId={serverId}
              isRunning={isRunning}
              serverType={server.type}
            />
          </TabsContent>

          <TabsContent
            value="properties"
            className="panel mt-0 border border-t-0 border-border modern:mt-3 modern:overflow-hidden modern:rounded-[16px] modern:border-t modern:bg-card modern:shadow-surface"
            style={{ minHeight: "480px" }}
          >
            <PropertiesPanel serverId={serverId} />
          </TabsContent>

          <TabsContent
            value="backups"
            className="panel mt-0 border border-t-0 border-border modern:mt-3 modern:overflow-hidden modern:rounded-[16px] modern:border-t modern:bg-card modern:shadow-surface"
          >
            <BackupsPanel serverId={serverId} />
          </TabsContent>

          <TabsContent
            value="settings"
            className="panel mt-0 border border-t-0 border-border modern:mt-3 modern:overflow-hidden modern:rounded-[16px] modern:border-t modern:bg-card modern:shadow-surface"
          >
            <div className="divide-y divide-border">
              <AppearancePanel
                server={server}
                onChanged={() => refreshServerMeta().catch(() => {})}
              />
              {[
                {
                  label: "Server Name",
                  value: server.name,
                  field: "name" as const,
                },
                {
                  label: "Version",
                  value:
                    server.type === "bedrock"
                      ? "Always latest"
                      : server.version +
                        (server.loader_version
                          ? ` / ${server.loader_version}`
                          : ""),
                  field: "version" as const,
                },
                {
                  label: "Port",
                  value: server.port != null ? String(server.port) : "—",
                  field: "port" as const,
                },
                {
                  label: "RAM",
                  value:
                    server.mem_min != null && server.mem_max != null
                      ? `${server.mem_min} GB / ${server.mem_max} GB`
                      : "Edit min/max heap",
                  field: "ram" as const,
                },
              ].map(({ label, value, field }) => (
                <div
                  key={field}
                  className="flex items-center justify-between px-6 py-4"
                >
                  <div>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-sm font-medium">{value}</p>
                  </div>
                  {/* Bedrock always runs the latest release — nothing to edit */}
                  {!(field === "version" && server.type === "bedrock") && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEdit(field)}
                    >
                      <Pencil className="size-3.5" />
                      Edit
                    </Button>
                  )}
                </div>
              ))}

              {/* Cheats — Bedrock only. allow-cheats is only read at server
                  startup, so toggling it always restarts the container. */}
              {server.type === "bedrock" && (
                <div className="flex items-center justify-between px-6 py-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Cheats</p>
                    <p className="text-sm font-medium">
                      {cheatsEnabled === null
                        ? "Loading…"
                        : cheatsEnabled
                          ? "Enabled"
                          : "Disabled"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={cheatsEnabled === null || cheatsSaving}
                    onClick={() => setCheatsConfirmOpen(true)}
                  >
                    {cheatsSaving ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Pencil className="size-3.5" />
                    )}
                    {cheatsEnabled ? "Disable" : "Enable"}
                  </Button>
                </div>
              )}

              {/* Recreate — rebuilds the container from current DB config,
                  no settings change. Useful when backend/image updates
                  require a fresh container (new labels, env vars, etc.)
                  that an existing container won't pick up on its own.
                  World data lives on the bind-mounted volume, not in the
                  container, so it survives — a backup is still taken first
                  as a safety net. */}
              <div className="flex items-center justify-between px-6 py-4">
                <div>
                  <p className="text-xs text-muted-foreground">
                    Recreate Container
                  </p>
                  <p className="text-sm font-medium">
                    {recreating
                      ? recreateStep || "Working…"
                      : "Rebuild from current config"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={recreating}
                  onClick={() => setRecreateConfirmOpen(true)}
                >
                  {recreating ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                  Recreate
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Stop / Kill confirm */}
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
              onClick={() => {
                const action = confirmAction!
                setConfirmAction(null)
                execAction(action)
              }}
            >
              {confirmAction === "kill" ? "Kill" : "Stop"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bedrock cheats toggle confirm */}
      <Dialog
        open={cheatsConfirmOpen}
        onOpenChange={(open) => {
          if (!open) setCheatsConfirmOpen(false)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {cheatsEnabled ? "Disable Cheats" : "Enable Cheats"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {`allow-cheats is only read when the server starts up, so this will
            restart the server to apply the change. Players will be
            disconnected briefly.`}
          </p>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setCheatsConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleToggleCheats}>
              {cheatsEnabled ? "Disable & Restart" : "Enable & Restart"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recreate container confirm */}
      <Dialog
        open={recreateConfirmOpen}
        onOpenChange={(open) => {
          if (!open) setRecreateConfirmOpen(false)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Recreate Container</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This stops, removes, and rebuilds the container from the
            server&apos;s current settings — no settings will change, and world
            data isn&apos;t touched since it lives outside the container. This
            is mainly useful after a backend update that an existing container
            needs to pick up.
          </p>
          <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5 text-sm">
            <span>
              Create a backup first
              <span className="block text-xs text-muted-foreground">
                Optional. Your world is kept either way.
              </span>
            </span>
            <Switch
              checked={recreateBackup}
              onCheckedChange={setRecreateBackup}
            />
          </label>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setRecreateConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleRecreate}>
              {recreateBackup ? "Back Up & Recreate" : "Recreate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete server confirm */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Server</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete{" "}
            <span className="font-medium text-foreground">{server.name}</span>{" "}
            and all associated resources. This cannot be undone.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete Server
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change owner (admins) */}
      <Dialog
        open={ownerUsers !== null}
        onOpenChange={(open) => !open && setOwnerUsers(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Change owner</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleChangeOwner} className="space-y-4 pt-1">
            <p className="text-sm text-muted-foreground">
              The owner can see and manage this server. Admins always can.
            </p>
            <Label htmlFor="server-owner">Owner</Label>
            <select
              id="server-owner"
              value={ownerChoice}
              onChange={(e) => setOwnerChoice(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              {ownerUsers?.map((u) => (
                <option key={u.id} value={u.id} className="bg-background">
                  {u.username}
                </option>
              ))}
            </select>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOwnerUsers(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={ownerSaving || !ownerChoice}>
                {ownerSaving && <Loader2 className="size-3.5 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Custom Cloudflare address */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename custom address</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRenameSubdomain} className="space-y-4 pt-1">
            <Label htmlFor="custom-subdomain">Subdomain</Label>
            <Input
              id="custom-subdomain"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              disabled={renaming}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={renaming || !renameValue.trim()}>
                {renaming && <Loader2 className="size-3.5 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Settings edit dialog */}
      <Dialog
        open={editField !== null}
        onOpenChange={(open) => {
          if (!open) setEditField(null)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {editField === "name"
                ? "Rename Server"
                : editField === "port"
                  ? "Change Port"
                  : editField === "version"
                    ? "Change Version"
                    : "Change RAM"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditSave} className="space-y-4 pt-1">
            {editField === "version" && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Minecraft Version</Label>
                  <VersionPicker
                    value={editValues.version}
                    onChange={(v) =>
                      setEditValues((prev) => ({ ...prev, version: v }))
                    }
                    disabled={editSaving}
                  />
                </div>
                {["forge", "fabric"].includes(server.type) && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="edit-loader-ver">Loader Version</Label>
                      <span className="text-[10px] text-muted-foreground">
                        empty = latest
                      </span>
                    </div>
                    <VersionPicker
                      value={editValues.loader_version}
                      onChange={(v) =>
                        setEditValues((prev) => ({
                          ...prev,
                          loader_version: v,
                        }))
                      }
                      disabled={editSaving}
                      mode="loader"
                      loaderType={server.type as "forge" | "fabric"}
                      gameVersion={editValues.version.trim()}
                    />
                  </div>
                )}
              </div>
            )}
            {editField === "name" && (
              <div className="space-y-1.5">
                <Label htmlFor="edit-name">Server Name</Label>
                <Input
                  id="edit-name"
                  value={editValues.name}
                  onChange={(e) =>
                    setEditValues((v) => ({ ...v, name: e.target.value }))
                  }
                  disabled={editSaving}
                  autoFocus
                />
              </div>
            )}
            {editField === "port" && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="edit-port">Port</Label>
                  <span className="text-xs text-muted-foreground">
                    1024–65535
                    {server.type === "bedrock" ? " (UDP)" : ""}
                  </span>
                </div>
                <Input
                  id="edit-port"
                  type="number"
                  min={1024}
                  max={65535}
                  value={editValues.port}
                  onChange={(e) => {
                    setEditValues((v) => ({ ...v, port: e.target.value }))
                    setPortError("")
                  }}
                  disabled={editSaving}
                  autoFocus
                />
                {portError && (
                  <p className="text-xs text-destructive">{portError}</p>
                )}
              </div>
            )}
            {editField === "ram" && (
              <div
                className={
                  server.type === "bedrock"
                    ? "grid grid-cols-1 gap-3"
                    : "grid grid-cols-2 gap-3"
                }
              >
                {server.type !== "bedrock" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-memmin">Min (GB)</Label>
                    <Input
                      id="edit-memmin"
                      type="number"
                      min={1}
                      value={editValues.mem_min}
                      onChange={(e) =>
                        setEditValues((v) => ({
                          ...v,
                          mem_min: e.target.value,
                        }))
                      }
                      disabled={editSaving}
                      autoFocus
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="edit-memmax">
                    {server.type === "bedrock"
                      ? "Memory Limit (GB)"
                      : "Max (GB)"}
                  </Label>
                  <Input
                    id="edit-memmax"
                    type="number"
                    min={1}
                    value={editValues.mem_max}
                    onChange={(e) =>
                      setEditValues((v) => ({ ...v, mem_max: e.target.value }))
                    }
                    disabled={editSaving}
                    autoFocus={server.type === "bedrock"}
                  />
                </div>
              </div>
            )}
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditField(null)}
                disabled={editSaving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={editSaving}>
                {editSaving && <Loader2 className="size-3.5 animate-spin" />}
                {editSaving ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
