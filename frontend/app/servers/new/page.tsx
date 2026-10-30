"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import { TopNav } from "@/components/TopNav"
import { ServerCreateModal } from "@/components/ServerCreateModal"
import { navigate } from "@/components/PageTransitions"
import { RequireAuth } from "@/components/RequireAuth"
import { api } from "@/lib/api"
import { useServerCreation } from "@/hooks/useServerCreation"

/** creating a server, as its own page instead of a pop-up */
export default function NewServerPage() {
  const router = useRouter()
  const { task, start, dismiss } = useServerCreation()
  // whether servers can get a public (Playit) address
  const [publicAvailable, setPublicAvailable] = useState(true)

  useEffect(() => {
    api.setup
      .get()
      .then((setup) => setPublicAvailable(setup.public_available ?? true))
      .catch(() => {})
  }, [])

  // once it's ready, open the new server
  const readyId = task?.stage === "ready" ? task.serverId : null
  useEffect(() => {
    if (readyId == null) return
    const t = setTimeout(() => {
      dismiss()
      navigate(`/servers/${readyId}`, router.push)
    }, 1500)
    return () => clearTimeout(t)
  }, [readyId, dismiss, router])

  const back = () => navigate("/servers", router.push)

  return (
    <RequireAuth>
      {(user, logout) => (
        <div className="min-h-screen bg-background">
          <TopNav user={user} onLogout={logout} />
          <main className="page-content enter mx-auto w-full max-w-xl px-6 py-8 [--page-name:page-new]">
            <Link
              href="/servers"
              className="mb-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground modern:mb-4 modern:text-[13px] modern:font-medium modern:text-tint modern:hover:text-tint/80"
            >
              <ArrowLeft className="size-3.5" />
              Servers
            </Link>
            <ServerCreateModal
              asPage
              open
              onOpenChange={(open) => {
                if (!open) back()
              }}
              task={task}
              onStart={start}
              onDismiss={dismiss}
              publicAvailable={publicAvailable}
            />
          </main>
        </div>
      )}
    </RequireAuth>
  )
}
