"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Loader2 } from "lucide-react"

import { TopNav } from "@/components/TopNav"
import { AuthPage, AuthStatusError } from "@/components/AuthPage"
import { SetupWizard } from "@/components/SetupWizard"
import { UsersPanel } from "@/components/UsersPanel"
import { AccountPanel } from "@/components/AccountPanel"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAuth } from "@/hooks/useAuth"

type Tab = "connection" | "users" | "account"
const TABS: Tab[] = ["connection", "users", "account"]

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
  // /settings?tab=users opens that tab
  const [tab, setTab] = useState<Tab>(() => {
    const wanted =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("tab")
    return TABS.includes(wanted as Tab) ? (wanted as Tab) : "connection"
  })

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

  // connection settings and users are for admins; everyone has an account tab
  const isAdmin = !!user?.is_admin
  const current: Tab = isAdmin ? tab : "account"

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
          value={current}
          onValueChange={(value) => {
            setTab(value as Tab)
            window.history.replaceState(
              null,
              "",
              value === "connection" ? "/settings" : `/settings?tab=${value}`
            )
          }}
          className="mt-6 flex flex-col gap-0"
        >
          <TabsList
            variant="line"
            className="mb-6 w-full justify-start border-b border-border pb-0"
          >
            {isAdmin && (
              <>
                <TabsTrigger value="connection">Connection</TabsTrigger>
                <TabsTrigger value="users">Users</TabsTrigger>
              </>
            )}
            <TabsTrigger value="account">Account</TabsTrigger>
          </TabsList>
          {isAdmin && (
            <>
              <TabsContent value="connection">
                <SetupWizard firstRun={false} onDone={() => router.push("/")} />
              </TabsContent>
              <TabsContent value="users">
                <UsersPanel />
              </TabsContent>
            </>
          )}
          <TabsContent value="account">
            <AccountPanel username={user?.username ?? ""} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
