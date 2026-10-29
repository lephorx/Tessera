"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Loader2 } from "lucide-react"

import { TopNav } from "@/components/TopNav"
import { AuthPage, AuthStatusError } from "@/components/AuthPage"
import { SetupWizard } from "@/components/SetupWizard"
import { UsersPanel } from "@/components/UsersPanel"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAuth } from "@/hooks/useAuth"

type Tab = "connection" | "users"

export default function SettingsPage() {
  const router = useRouter()
  const {
    loading,
    statusError,
    setupRequired,
    authenticated,
    user,
    onLoginSuccess,
    retryStatus,
    logout,
  } = useAuth()
  // /settings?tab=users opens the users tab
  const [tab, setTab] = useState<Tab>(() =>
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("tab") === "users"
      ? "users"
      : "connection"
  )

  if (loading) {
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

  return (
    <div className="min-h-screen bg-background">
      <TopNav user={user} onLogout={logout} />
      <main className="mx-auto w-full max-w-xl px-6 py-8">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Servers
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value as Tab)
            window.history.replaceState(
              null,
              "",
              value === "users" ? "/settings?tab=users" : "/settings"
            )
          }}
          className="mt-6 flex flex-col gap-0"
        >
          <TabsList
            variant="line"
            className="mb-6 w-full justify-start border-b border-border pb-0"
          >
            <TabsTrigger value="connection">Connection</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
          </TabsList>
          <TabsContent value="connection">
            <SetupWizard firstRun={false} onDone={() => router.push("/")} />
          </TabsContent>
          <TabsContent value="users">
            <UsersPanel />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
