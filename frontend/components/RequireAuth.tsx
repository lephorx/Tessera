"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"

import { AuthPage, AuthStatusError } from "@/components/AuthPage"
import { useAuth, type AuthUser } from "@/hooks/useAuth"

/** shows sign-in (or the error) until there's a user, then the page;
 *  `admin` pages send everyone else back to the dashboard */
export function RequireAuth({
  admin = false,
  children,
}: {
  admin?: boolean
  children: (user: AuthUser, logout: () => void) => React.ReactNode
}) {
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
  const forbidden = admin && !!user && !user.is_admin

  useEffect(() => {
    if (forbidden) router.replace("/servers")
  }, [forbidden, router])

  if (loading || forbidden) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (statusError)
    return <AuthStatusError message={statusError} onRetry={retryStatus} />
  if (setupRequired || !authenticated || !user)
    return (
      <AuthPage
        initialView={setupRequired ? "setup-form" : "login-form"}
        onLoginSuccess={onLoginSuccess}
      />
    )
  return <>{children(user, logout)}</>
}
